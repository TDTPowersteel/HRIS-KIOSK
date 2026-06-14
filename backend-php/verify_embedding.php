<?php
// Face Embedding verification endpoint with multi-angle support.

ini_set('display_errors', '0');
ini_set('display_startup_errors', '0');
error_reporting(E_ALL);

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, Accept');
header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

require_once __DIR__ . '/FaceVerificationHelper.php';

$input = json_decode(file_get_contents('php://input'), true) ?? $_REQUEST;

$userId = isset($input['log_id']) ? trim((string) $input['log_id']) : null;
$liveEmbeddingRaw = $input['live_embedding'] ?? null;
$liveImageB64 = $input['live_image_b64'] ?? null;
$engine = isset($input['engine']) ? trim((string) $input['engine']) : '';
$mlServerUrl = getenv('ML_SERVER_URL') ?: 'http://localhost:5001';

if ($userId === 'warmup') {
    if ($liveImageB64) {
        $ch = curl_init($mlServerUrl . '/embed_single');
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode(['image' => $liveImageB64]));
        curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
        curl_setopt($ch, CURLOPT_TIMEOUT, 3);
        curl_exec($ch);
        curl_close($ch);
    }
    http_response_code(200);
    echo json_encode(['ok' => true, 'message' => 'Warmup completed.']);
    exit;
}

if (!$userId) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'message' => 'Missing parameter (log_id)']);
    exit;
}

$liveEmbedding = null;
if ($liveImageB64) {
    // Forward crop base64 to local Python ML server
    $ch = curl_init($mlServerUrl . '/embed_single');
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode(['image' => $liveImageB64]));
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode === 200 && $response) {
        $resData = json_decode($response, true);
        if (isset($resData['ok']) && $resData['ok'] && isset($resData['embedding'])) {
            $liveEmbedding = $resData['embedding'];
        }
    }
    
    if (!$liveEmbedding) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'message' => 'Server-side face extraction failed.']);
        exit;
    }
} else if ($liveEmbeddingRaw) {
    if (is_array($liveEmbeddingRaw)) {
        $liveEmbedding = $liveEmbeddingRaw;
    } else if (is_string($liveEmbeddingRaw)) {
        $liveEmbedding = json_decode($liveEmbeddingRaw, true);
    }
}

if (!is_array($liveEmbedding) || count($liveEmbedding) === 0) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'message' => 'Invalid live_embedding format (must be array of numbers)']);
    exit;
}

[$faceData, $errorMsg] = fetchUserFaceData($userId, $engine);

if ($errorMsg) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'message' => $errorMsg]);
    exit;
}

$storedEmbeddingStr = $faceData['face_embedding'] ?? null;
if (!$storedEmbeddingStr) {
    http_response_code(404);
    echo json_encode(['ok' => false, 'message' => 'No face embedding registered for this user']);
    exit;
}

$storedEmbedding = json_decode($storedEmbeddingStr, true);
if (!is_array($storedEmbedding)) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'message' => 'Stored embedding corrupted.']);
    exit;
}

// Detect format: flat [512] or multi-angle [[512], [512], ...]
$isMultiAngle = count($storedEmbedding) > 0 && is_array($storedEmbedding[0]);
$angleEmbeddings = $isMultiAngle ? $storedEmbedding : [$storedEmbedding];

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
    $sim = $denom === 0.0 ? 0 : $dot / $denom;
    $perAngleScores[] = $sim;

    if ($sim > $maxSimilarity) {
        $maxSimilarity = $sim;
        $bestAngleIndex = $idx;
    }
}

$matchThreshold = 0.52;
$subThreshold = 0.45;

// top2_agree: require at least 2 angles to agree above sub-threshold
$agreeingAngles = count(array_filter($perAngleScores, fn($s) => $s >= $subThreshold));
$top2Agrees = count($angleEmbeddings) < 3 || $agreeingAngles >= 2;

$isMatch = $maxSimilarity >= $matchThreshold && $top2Agrees;

$message = null;
$hint = null;
if (!$isMatch) {
    $message = "Verification failed.";
    $hint = "Please try again.";
}

echo json_encode([
    'ok' => $isMatch,
    'log_id' => $userId,
    'username' => $faceData['username'],
    'similarity' => $maxSimilarity,
    'threshold' => $matchThreshold,
    'is_match' => $isMatch,
    'verified' => $isMatch,
    'message' => $message,
    'hint' => $hint,
    'decision' => $isMatch ? 'PASS' : 'FAIL',
    'angle_count' => count($angleEmbeddings),
    'best_angle_index' => $bestAngleIndex,
    'per_angle_scores' => $perAngleScores,
    'agreeing_angles' => $agreeingAngles,
]);
