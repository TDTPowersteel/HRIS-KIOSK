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
// Verify endpoint - accepts multipart form with 'photo' file and optional 'user_id'

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, Accept');
header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
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

$photoBase64 = null;

// Read uploaded file first.
if (!empty($_FILES['photo']) && !empty($_FILES['photo']['tmp_name'])) {
    $tmp = $_FILES['photo']['tmp_name'];
    $photoData = @file_get_contents($tmp);
    if ($photoData === false) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'message' => 'Failed to read uploaded file']);
        exit;
    }

    $photoBase64 = base64_encode($photoData);
} elseif (!empty($_POST['photo_base64'])) {
    $photoBase64 = trim((string)$_POST['photo_base64']);
    if (preg_match('/^data:image\/[a-zA-Z0-9.+-]+;base64,/', $photoBase64)) {
        $photoBase64 = preg_replace('/^data:image\/[a-zA-Z0-9.+-]+;base64,/', '', $photoBase64);
    }
    $decodedPhoto = base64_decode($photoBase64, true);
    if ($decodedPhoto === false) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'message' => 'Invalid photo_base64 data']);
        exit;
    }
    $photoBase64 = base64_encode($decodedPhoto);
} else {
    http_response_code(400);
    echo json_encode([
        'ok' => false,
        'message' => 'Missing photo file',
        'hint' => 'Send multipart field "photo" or base64 field "photo_base64".'
    ]);
    exit;
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

// Use Face++ compare when properly configured
$faceppConfigured = function_exists('facepp_api_configured') ? facepp_api_configured() : false;
$luxandConfigured = function_exists('luxand_face_api_configured') ? luxand_face_api_configured() : false;

if ($faceppConfigured && function_exists('facepp_compare_faces')) {
    $result = facepp_compare_faces($photoBase64, $storedFaceBase64);
    if ($result === null) {
        $err = function_exists('facepp_get_last_error') ? facepp_get_last_error() : 'Face comparison failed';

        // If Face++ rejects the upload for size reasons, try Luxand before failing.
        if (
            $luxandConfigured &&
            function_exists('luxand_verify_faces') &&
            is_string($err) &&
            stripos($err, 'IMAGE_FILE_TOO_LARGE') !== false
        ) {
            error_log("Face++ rejected upload as too large; falling back to Luxand");
            $score = luxand_verify_faces($photoBase64, $storedFaceBase64);
            if ($score >= 0) {
                $threshold = 0.75;
                if ($score >= $threshold) {
                    echo json_encode([
                        'ok' => true,
                        'message' => 'Face matched',
                        'match_score' => $score,
                        'threshold' => $threshold,
                        'api' => 'luxand',
                    ]);
                    exit;
                }

                http_response_code(401);
                echo json_encode([
                    'ok' => false,
                    'message' => 'Face did not match',
                    'match_score' => $score,
                    'threshold' => $threshold,
                    'api' => 'luxand',
                ]);
                exit;
            }
        }

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
            'threshold' => $result['threshold']
        ]);
        exit;
    } else {
        http_response_code(401);
        echo json_encode([
            'ok' => false,
            'message' => 'Face did not match',
            'match_score' => $result['confidence'],
            'threshold' => $result['threshold']
        ]);
        exit;
    }
}

// Use Luxand compare when properly configured
if ($luxandConfigured && function_exists('luxand_verify_faces')) {
    $score = luxand_verify_faces($photoBase64, $storedFaceBase64);
    if ($score < 0) {
        $err = function_exists('luxand_get_last_error') ? luxand_get_last_error() : 'Luxand comparison failed';
        http_response_code(500);
        echo json_encode(['ok' => false, 'message' => 'Face comparison error', 'detail' => $err]);
        exit;
    }

    $threshold = 0.75;
    if ($score >= $threshold) {
        echo json_encode([
            'ok' => true,
            'message' => 'Face matched',
            'match_score' => $score,
            'threshold' => $threshold
        ]);
        exit;
    } else {
        http_response_code(401);
        echo json_encode([
            'ok' => false,
            'message' => 'Face did not match',
            'match_score' => $score,
            'threshold' => $threshold
        ]);
        exit;
    }
}

// Default: provider not configured and verification is required.
$verifyMode = strtolower(trim((string)(getenv('FACE_VERIFY_MODE') ?: 'required')));
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
