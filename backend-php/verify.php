<?php
ini_set('display_errors', '0');
ini_set('display_startup_errors', '0');
ini_set('memory_limit', '512M');
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
// Verify endpoint - accepts multipart form with 'photo' file and optional 'user_id'

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

require_once __DIR__ . '/connect.php';

// Try to include Face++ helper if available
if (file_exists(__DIR__ . '/facepp_api.php')) {
    require_once __DIR__ . '/facepp_api.php';
}
// Try to include Luxand helper if available
if (file_exists(__DIR__ . '/luxand_face_api.php')) {
    require_once __DIR__ . '/luxand_face_api.php';
}

// Read uploaded files
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

// Optional: Liveness Photo (Shot 2)
$photoLivenessBase64 = null;
if (!empty($_FILES['photo_liveness']) && !empty($_FILES['photo_liveness']['tmp_name'])) {
    $tmp2 = $_FILES['photo_liveness']['tmp_name'];
    $photoData2 = @file_get_contents($tmp2);
    if ($photoData2 !== false) {
        $photoLivenessBase64 = base64_encode($photoData2);
    }
}

$userId = isset($_POST['user_id']) ? trim($_POST['user_id']) : null;

// Require user_id so verification is tied to the logged-in user
if (!$userId) {
    http_response_code(400);
    echo json_encode([
        'ok' => false,
        'message' => 'Missing user_id',
        'hint' => 'Send user_id from the logged-in session so verification matches the correct account.'
    ]);
    exit;
}

// 1. LIVENESS CHECK (Micro-Movement)
// 100% FREE security: Comparing Shot 1 vs Shot 2 to catch static photos.
$faceppConfigured = function_exists('facepp_api_configured') ? facepp_api_configured() : false;
$lScore = null;

if ($photoLivenessBase64 && $faceppConfigured && function_exists('facepp_compare_faces')) {
    $livenessResult = facepp_compare_faces($photoBase64, $photoLivenessBase64);

    if ($livenessResult !== null) {
        $lScore = $livenessResult['confidence'];

        // LOGIC UPDATE:
        // - We increased the camera gap between shots to 700ms.
        // - A handheld static ID photo will still score very high (e.g., 95% - 98%) even with minor hand shake over 700ms.
        // - A real, live breathing human will shift significantly over 700ms, naturally scoring between 70% and 90%.
        // - By drastically tightening the limit to 0.930 (93.0%), we achieve maximum security against static pictures.

        if ($lScore >= 0.930) {
            http_response_code(401);
            echo json_encode([
                'ok' => false,
                'message' => 'Liveness check failed.',
                'hint' => 'Please face the camera, blink, and smile naturally :)',
                'liveness_score' => $lScore,
                'debug_info' => 'Similarity too high (' . ($lScore * 100) . '%) - looks like a static image.'
            ]);
            exit;
        }

        if ($lScore < 0.80) {
            $isVeryLow = $lScore < 0.50;
            http_response_code(401);
            echo json_encode([
                'ok' => false,
                'message' => 'Liveness check failed.',
                'hint' => $isVeryLow 
                    ? 'Please face the camera directly. Handheld photos or screen captures are not allowed.'
                    : 'Please hold the tablet steady, face the camera, and smile :).',
                'liveness_score' => $lScore,
                'debug_info' => 'Similarity too low (' . ($lScore * 100) . '%) - face moved too much or changed.'
            ]);
            exit;
        }

        error_log("[Verify] Liveness Passed: Score " . $lScore);
    }
}

// If user_id provided, fetch stored face from Supabase
$storedFaceBase64 = null;
[$status, $data, $err] = supabase_request('GET', "rest/v1/accounts?log_id=eq." . urlencode($userId) . "&select=face,username,log_id");
if ($err) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'message' => 'Database connection error', 'detail' => $err]);
    exit;
}
if ($status !== 200 || !is_array($data) || count($data) === 0) {
    http_response_code(404);
    echo json_encode(['ok' => false, 'message' => 'User not found']);
    exit;
}
$account = $data[0];
$storedFace = $account['face'] ?? null;
if ($storedFace && is_string($storedFace)) {
    // Normalize: PostgreSQL bytea can come back as hex (\x2f396a... or raw hex) or as text (data URI / base64)
    $hex = null;
    if (strpos($storedFace, '\\x') === 0 && strlen($storedFace) > 2) {
        $hex = substr($storedFace, 2);
    } elseif (strlen($storedFace) > 20 && ctype_xdigit($storedFace)) {
        $hex = $storedFace;
    }
    if ($hex !== null) {
        $decoded = @hex2bin($hex);
        $storedFaceBase64 = ($decoded !== false) ? $decoded : $storedFace;
    } else {
        $storedFaceBase64 = $storedFace;
    }
} else {
    $storedFaceBase64 = null;
}

// If no stored face available, respond with 404 so client can fall back
if (!$storedFaceBase64) {
    http_response_code(404);
    echo json_encode(['ok' => false, 'message' => 'No stored face for user']);
    exit;
}

// 2. IDENTITY VERIFICATION (Existing logic)
if ($faceppConfigured && function_exists('facepp_compare_faces')) {
    $result = facepp_compare_faces($photoBase64, $storedFaceBase64);
    if ($result === null) {
        $err = function_exists('facepp_get_last_error') ? facepp_get_last_error() : 'Face comparison failed';
        http_response_code(500);
        echo json_encode(['ok' => false, 'message' => 'Face comparison error', 'detail' => $err]);
        exit;
    }

    // result contains 'similar' boolean and confidence (0-1)
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
        exit;
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
        exit;
    }
}

// (RESERVED: Placeholder for other providers like Luxand)
/*
$luxandConfigured = function_exists('luxand_face_api_configured') ? luxand_face_api_configured() : false;
if ($luxandConfigured && function_exists('luxand_verify_faces')) {
    // ... Luxand verification logic here
}
*/

// Default: provider not configured and verification is required.
$verifyMode = strtolower(trim((string) (getenv('FACE_VERIFY_MODE') ?: 'required')));
http_response_code(501);
echo json_encode([
    'ok' => false,
    'message' => 'No face recognition provider configured on server.',
    'hint' => 'Set FACEPP_API_KEY and FACEPP_API_SECRET in the PHP server environment (or backend-php/.env), or set FACE_VERIFY_MODE=optional/off for dev, then restart the backend.',
    'debug' => [
        'facepp_configured' => $faceppConfigured,
        'has_FACEPP_API_KEY' => !empty(getenv('FACEPP_API_KEY')),
        'has_FACEPP_API_SECRET' => !empty(getenv('FACEPP_API_SECRET')),
        'luxand_configured' => $luxandConfigured,
        'FACE_VERIFY_MODE' => $verifyMode,
    ],
]);
exit;

?>

<?php
if (ob_get_level()) {
    ob_end_flush();
}
?>