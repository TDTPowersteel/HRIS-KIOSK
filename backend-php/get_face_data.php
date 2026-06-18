<?php
// Dedicated endpoint to fetch registered user face data & embedding directly by log_id or username.

ini_set('display_errors', '0');
ini_set('display_startup_errors', '0');
error_reporting(E_ALL);

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, Accept');
header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

require_once __DIR__ . '/FaceVerificationHelper.php';

$userId = isset($_GET['log_id']) ? trim((string)$_GET['log_id']) : null;
$username = isset($_GET['username']) ? trim((string)$_GET['username']) : null;
$engine = isset($_GET['engine']) ? trim((string)$_GET['engine']) : '';

if (!$userId && !$username) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'message' => 'Missing parameter (log_id or username)']);
    exit;
}

if (!$userId && $username) {
    if (strpos($username, 'intern_') === 0 || (defined('KIOSK_MODE') && KIOSK_MODE === 'intern')) {
        $userId = $username;
    } else {
        [$status, $data, $err] = supabase_request(
            'GET',
            "rest/v1/accounts?username=eq." . urlencode($username) . "&select=log_id"
        );
        if ($err || $status !== 200 || !is_array($data) || count($data) === 0) {
            http_response_code(404);
            echo json_encode(['ok' => false, 'message' => 'Account not found by username', 'detail' => $err]);
            exit;
        }
        $userId = $data[0]['log_id'];
    }
}

[$faceData, $errorMsg] = fetchUserFaceData($userId, $engine);

if ($errorMsg) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'message' => $errorMsg]);
    exit;
}

echo json_encode([
    'ok' => true,
    'log_id' => $faceData['log_id'],
    'username' => $faceData['username'],
    'profile_picture' => $faceData['profile_picture'],
    'has_face_image' => !empty($faceData['face']),
    'has_face_embedding' => !empty($faceData['face_embedding']),
    'face_image_len' => $faceData['face'] ? strlen($faceData['face']) : 0,
    'face_embedding_len' => $faceData['face_embedding'] ? strlen($faceData['face_embedding']) : 0,
    'face_embedding' => $faceData['face_embedding'] ? json_decode($faceData['face_embedding']) : null
]);
