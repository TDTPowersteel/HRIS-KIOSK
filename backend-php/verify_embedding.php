<?php
// PHP-based Face Embedding verification endpoint to run cosine similarity checks for comparison and math verification.

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

$userId = isset($input['log_id']) ? trim((string)$input['log_id']) : null;
$liveEmbeddingRaw = $input['live_embedding'] ?? null;
$engine = isset($input['engine']) ? trim((string)$input['engine']) : '';

if (!$userId || !$liveEmbeddingRaw) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'message' => 'Missing parameter (log_id and live_embedding)']);
    exit;
}

$liveEmbedding = null;
if (is_array($liveEmbeddingRaw)) {
    $liveEmbedding = $liveEmbeddingRaw;
} else if (is_string($liveEmbeddingRaw)) {
    $liveEmbedding = json_decode($liveEmbeddingRaw, true);
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
if (!is_array($storedEmbedding) || count($storedEmbedding) !== count($liveEmbedding)) {
    http_response_code(500);
    echo json_encode([
        'ok' => false,
        'message' => 'Stored embedding dimension mismatch or corrupted.',
        'stored_len' => is_array($storedEmbedding) ? count($storedEmbedding) : 0,
        'live_len' => count($liveEmbedding)
    ]);
    exit;
}

// Cosine similarity
$dot = 0;
$normA = 0;
$normB = 0;
for ($i = 0; $i < count($liveEmbedding); $i++) {
    $dot += $liveEmbedding[$i] * $storedEmbedding[$i];
    $normA += $liveEmbedding[$i] * $liveEmbedding[$i];
    $normB += $storedEmbedding[$i] * $storedEmbedding[$i];
}

$denom = sqrt($normA) * sqrt($normB);
$similarity = $denom === 0 ? 0 : $dot / $denom;

$matchThreshold = 0.65;
$isMatch = $similarity >= $matchThreshold;

echo json_encode([
    'ok' => true,
    'log_id' => $userId,
    'username' => $faceData['username'],
    'similarity' => $similarity,
    'threshold' => $matchThreshold,
    'is_match' => $isMatch,
    'decision' => $isMatch ? 'PASS' : 'FAIL'
]);
