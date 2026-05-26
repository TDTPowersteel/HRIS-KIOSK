<?php
/**
 * Reusable Face Verification API
 * 
 * Standalone endpoint for face verification via embedding comparison.
 * Callable from HRIS-KIOSK, HRIS-APP, and HRIS-WEB.
 * Handles both single [512] and multi-angle [[512], [512], ...] stored embeddings.
 *
 * POST JSON: { "log_id": "123", "live_embedding": [...], "threshold": 0.42 }
 * Response:  { "ok": true, "verified": true, "similarity": 0.58, ... }
 */

ini_set('display_errors', '0');
ini_set('display_startup_errors', '0');
error_reporting(E_ALL);
ob_start();

register_shutdown_function(function () {
    $err = error_get_last();
    if ($err && in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
        if (ob_get_length()) ob_end_clean();
        http_response_code(500);
        header('Content-Type: application/json');
        echo json_encode(['ok' => false, 'message' => 'Server error', 'detail' => $err['message']]);
    }
});

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, Accept');
header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'message' => 'Method not allowed. Use POST.']);
    exit;
}

require_once __DIR__ . '/FaceVerificationHelper.php';

$input = json_decode(file_get_contents('php://input'), true);
if (!$input) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'message' => 'Invalid JSON body']);
    exit;
}

$userId = isset($input['log_id']) ? trim((string)$input['log_id']) : null;
$liveEmbeddingRaw = $input['live_embedding'] ?? null;
$customThreshold = isset($input['threshold']) ? (float)$input['threshold'] : null;

if (!$userId) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'message' => 'Missing required parameter: log_id']);
    exit;
}

if (!$liveEmbeddingRaw) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'message' => 'Missing required parameter: live_embedding']);
    exit;
}

// Parse live embedding
$liveEmbedding = null;
if (is_array($liveEmbeddingRaw)) {
    $liveEmbedding = $liveEmbeddingRaw;
} else if (is_string($liveEmbeddingRaw)) {
    $liveEmbedding = json_decode($liveEmbeddingRaw, true);
}

if (!is_array($liveEmbedding) || count($liveEmbedding) < 64) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'message' => 'Invalid live_embedding: must be array of at least 64 numbers']);
    exit;
}

// Fetch stored embedding from database
[$faceData, $errorMsg] = fetchUserFaceData($userId, '');

if ($errorMsg) {
    $code = ($errorMsg === 'User not found') ? 404 : 500;
    http_response_code($code);
    echo json_encode(['ok' => false, 'message' => $errorMsg]);
    exit;
}

$storedEmbeddingStr = $faceData['face_embedding'] ?? null;
if (!$storedEmbeddingStr) {
    http_response_code(404);
    echo json_encode([
        'ok' => false,
        'message' => 'No face embedding registered for this user',
        'hint' => 'Ask the employee to register their face in the HRIS mobile app first.'
    ]);
    exit;
}

$storedEmbedding = json_decode($storedEmbeddingStr, true);
if (!is_array($storedEmbedding)) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'message' => 'Stored embedding data is corrupted']);
    exit;
}

// Detect format: flat [512] or multi-angle [[512], [512], ...]
$isMultiAngle = count($storedEmbedding) > 0 && is_array($storedEmbedding[0]);
$angleEmbeddings = $isMultiAngle ? $storedEmbedding : [$storedEmbedding];

// Compare against each angle, find max
$maxSimilarity = -1;
$bestAngleIndex = -1;
$perAngleScores = [];

foreach ($angleEmbeddings as $idx => $angleEmb) {
    if (!is_array($angleEmb) || count($angleEmb) !== count($liveEmbedding)) {
        $perAngleScores[] = -1;
        continue;
    }

    $dot = 0;
    $normA = 0;
    $normB = 0;
    for ($i = 0; $i < count($liveEmbedding); $i++) {
        $dot += $liveEmbedding[$i] * $angleEmb[$i];
        $normA += $liveEmbedding[$i] * $liveEmbedding[$i];
        $normB += $angleEmb[$i] * $angleEmb[$i];
    }

    $denom = sqrt($normA) * sqrt($normB);
    $sim = $denom == 0 ? 0 : $dot / $denom;
    $perAngleScores[] = round($sim, 6);

    if ($sim > $maxSimilarity) {
        $maxSimilarity = $sim;
        $bestAngleIndex = $idx;
    }
}

$matchThreshold = $customThreshold ?? 0.35;
$subThreshold = 0.28;

// top2_agree: for multi-angle embeddings, at least 2 angles must agree above sub-threshold
$agreeingAngles = count(array_filter($perAngleScores, fn($s) => $s >= $subThreshold));
$top2Agrees = count($angleEmbeddings) < 3 || $agreeingAngles >= 2;

$verified = $maxSimilarity >= $matchThreshold && $top2Agrees;

$response = json_encode([
    'ok' => true,
    'verified' => $verified,
    'similarity' => round($maxSimilarity, 6),
    'threshold' => $matchThreshold,
    'angle_count' => count($angleEmbeddings),
    'best_angle_index' => $bestAngleIndex,
    'per_angle_scores' => $perAngleScores,
    'agreeing_angles' => $agreeingAngles,
    'username' => $faceData['username'] ?? null,
    'log_id' => $userId,
]);

header('Content-Length: ' . strlen($response));
echo $response;

if (ob_get_level()) {
    ob_end_flush();
}
