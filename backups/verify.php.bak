<?php
ini_set('display_errors', '0');
ini_set('display_startup_errors', '0');
error_reporting(E_ALL);
ob_start();

register_shutdown_function(function () {
    $err = error_get_last();
    if ($err && in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
        if (ob_get_length()) {
            ob_end_clean();
        }
        http_response_code(500);
        header('Content-Type: application/json');
        echo json_encode([
            'ok' => false,
            'message' => 'Server error',
            'detail' => $err['message'],
        ]);
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

require_once __DIR__ . '/connect.php';

if (file_exists(__DIR__ . '/facepp_api.php')) {
    require_once __DIR__ . '/facepp_api.php';
}

// 1. Read Primary Photo
if (empty($_FILES['photo']) || empty($_FILES['photo']['tmp_name'])) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'message' => 'Missing primary photo file']);
    exit;
}

$photoData1 = @file_get_contents($_FILES['photo']['tmp_name']);
$photoBase64 = base64_encode($photoData1);

// 2. Read Liveness Photo (Shot 2)
$photoLivenessBase64 = null;
if (!empty($_FILES['photo_liveness']) && !empty($_FILES['photo_liveness']['tmp_name'])) {
    $photoData2 = @file_get_contents($_FILES['photo_liveness']['tmp_name']);
    if ($photoData2 !== false) {
        $photoLivenessBase64 = base64_encode($photoData2);
    }
}

$userId = isset($_POST['user_id']) ? trim($_POST['user_id']) : null;
if (!$userId) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'message' => 'Missing user_id']);
    exit;
}

$faceppConfigured = function_exists('facepp_api_configured') ? facepp_api_configured() : false;

// 3. LIVENESS SECURITY CHECK
if ($photoLivenessBase64 && $faceppConfigured && function_exists('facepp_compare_faces')) {
    $livenessResult = facepp_compare_faces($photoBase64, $photoLivenessBase64);
    
    if ($livenessResult !== null) {
        $lScore = $livenessResult['confidence_raw'] ?? ($livenessResult['confidence'] * 100);
        
        // REJECTION LOGIC FOR ID PICTURES:
        // A handheld ID or phone screen typically scores > 99.2% similarity because the image is flat.
        // A real person's skin and micro-movements result in 85% - 98% similarity.
        
        if ($lScore >= 99.2) {
            http_response_code(401);
            echo json_encode([
                'ok' => false,
                'message' => 'Security Alert: Static photo detected.',
                'hint' => 'Handheld photos, screen captures, or IDs are not allowed. Please face the camera naturally.',
                'debug' => [
                    'liveness_score' => $lScore,
                    'status' => 'REJECTED_STATIC'
                ]
            ]);
            exit;
        }
        
        // If score is too low, they moved too much or it's a different person
        if ($lScore < 75.0) {
            http_response_code(401);
            echo json_encode([
                'ok' => false,
                'message' => 'Liveness check failed.',
                'hint' => 'Please hold the tablet steady.',
                'debug' => ['liveness_score' => $lScore, 'status' => 'REJECTED_MOTION']
            ]);
            exit;
        }
    }
}

// 4. IDENTITY RECOGNITION (Against Database)
$storedFaceBase64 = null;
[$status, $data, $err] = supabase_request('GET', "rest/v1/accounts?log_id=eq." . urlencode($userId) . "&select=face,username,log_id");

if ($err || $status !== 200 || !is_array($data) || count($data) === 0) {
    http_response_code(404);
    echo json_encode(['ok' => false, 'message' => 'User not found or database error']);
    exit;
}

$storedFace = $data[0]['face'] ?? null;
if ($storedFace && is_string($storedFace)) {
    $hex = null;
    if (strpos($storedFace, '\\x') === 0) $hex = substr($storedFace, 2);
    elseif (strlen($storedFace) > 20 && ctype_xdigit($storedFace)) $hex = $storedFace;
    
    if ($hex !== null) {
        $decoded = @hex2bin($hex);
        $storedFaceBase64 = ($decoded !== false) ? base64_encode($decoded) : $storedFace;
    } else {
        $storedFaceBase64 = preg_replace('/^[^,]*;base64,/', '', trim($storedFace));
    }
}

if (!$storedFaceBase64) {
    http_response_code(404);
    echo json_encode(['ok' => false, 'message' => 'No stored face for user']);
    exit;
}

if ($faceppConfigured && function_exists('facepp_compare_faces')) {
    $result = facepp_compare_faces($photoBase64, $storedFaceBase64);
    
    if ($result === null) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'message' => 'Comparison error']);
        exit;
    }

    // IDENTITY MATCH
    if (!empty($result['similar'])) {
        echo json_encode([
            'ok' => true,
            'message' => 'Face matched',
            'match_score' => $result['confidence'],
            'threshold' => $result['threshold']
        ]);
        exit;
    } else {
        http_response_code(401);
        echo json_encode([
            'ok' => false,
            'message' => 'Face did not match database',
            'match_score' => $result['confidence'],
            'threshold' => $result['threshold']
        ]);
        exit;
    }
}

http_response_code(501);
echo json_encode(['ok' => false, 'message' => 'Face++ not configured']);
exit;
