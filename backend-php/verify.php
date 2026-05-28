<?php
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
    echo json_encode(['ok' => false, 'message' => 'Method not allowed']);
    exit;
}

require_once __DIR__ . '/FaceVerificationHelper.php';

if (empty($_FILES['photo']) || empty($_FILES['photo']['tmp_name'])) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'message' => 'Missing photo file']);
    exit;
}

$tmp1 = $_FILES['photo']['tmp_name'];
$photoData1 = @file_get_contents($tmp1);
if ($photoData1 === false) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'message' => 'Failed to read primary photo']);
    exit;
}

$photoBase64 = base64_encode($photoData1);

$photoLivenessBase64 = null;
if (!empty($_FILES['photo_liveness']) && !empty($_FILES['photo_liveness']['tmp_name'])) {
    $tmp2 = $_FILES['photo_liveness']['tmp_name'];
    $photoData2 = @file_get_contents($tmp2);
    if ($photoData2 !== false) {
        $photoLivenessBase64 = base64_encode($photoData2);
    }
}

$userId = isset($_POST['user_id']) ? trim($_POST['user_id']) : null;
$engine = isset($_POST['engine']) ? trim($_POST['engine']) : '';
if (!$userId) {
    http_response_code(400);
    echo json_encode([
        'ok' => false,
        'message' => 'Missing user_id',
        'hint' => 'Send user_id from the logged-in session so verification matches the correct account.'
    ]);
    exit;
}

// 1. Liveness check if active
$lScore = null;
if ($photoLivenessBase64) {
    $liveness = verifyLiveness($photoBase64, $photoLivenessBase64);
    if ($liveness[0] === null) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'message' => 'Liveness check error', 'detail' => $liveness[1]]);
        exit;
    }
    
    $lResult = $liveness[0];
    $lScore = $lResult['score'];
    
    if (!$lResult['passed']) {
        http_response_code(401);
        echo json_encode([
            'ok' => false,
            'message' => $lResult['message'],
            'liveness_score' => $lScore
        ]);
        exit;
    }
}

// 2. Fetch registered face
[$faceData, $errorMsg] = fetchUserFaceData($userId, $engine);
if ($errorMsg) {
    $code = ($errorMsg === 'User not found') ? 404 : 500;
    http_response_code($code);
    echo json_encode(['ok' => false, 'message' => $errorMsg]);
    exit;
}

if ($engine === 'camera_vision') {
    http_response_code(400);
    echo json_encode(['ok' => false, 'message' => 'Camera Vision verification must be executed locally on the client. backend-php/verify.php is only for Face++ api.']);
    exit;
}

$storedFaceBase64 = $faceData['face'] ?? null;
if (!$storedFaceBase64) {
    http_response_code(404);
    echo json_encode(['ok' => false, 'message' => 'No stored face for user']);
    exit;
}

// 3. Verify photo identity
[$result, $vError] = verifyFacePhoto($photoBase64, $storedFaceBase64);
if ($vError) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'message' => 'Face comparison error', 'detail' => $vError]);
    exit;
}

if (!empty($result['similar'])) {
    echo json_encode([
        'ok' => true,
        'message' => 'Face matched',
        'match_score' => $result['confidence'],
        'threshold' => $result['threshold'],
        'captured_faces_count' => $result['captured_faces_count'] ?? null,
        'reference_faces_count' => $result['reference_faces_count'] ?? null,
        'liveness_score' => $lScore
    ]);
} else {
    http_response_code(401);
    echo json_encode([
        'ok' => false,
        'message' => 'Face did not match',
        'match_score' => $result['confidence'],
        'threshold' => $result['threshold'],
        'captured_faces_count' => $result['captured_faces_count'] ?? null,
        'reference_faces_count' => $result['reference_faces_count'] ?? null,
        'liveness_score' => $lScore
    ]);
}

if (ob_get_level()) {
    ob_end_flush();
}