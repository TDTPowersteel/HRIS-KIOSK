<?php
/**
 * employee_details.php
 * Fetches high-quality profile picture for a single employee on demand.
 */

ini_set('memory_limit', '512M');
ini_set('display_errors', '0');
error_reporting(E_ALL);

require_once __DIR__ . '/connect.php';

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type, Authorization, apikey');
header('Access-Control-Allow-Methods: GET, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    echo json_encode(['ok' => true]);
    exit;
}

$userId = isset($_GET['user_id']) ? $_GET['user_id'] : null;

if (!$userId) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'message' => 'Missing user_id parameter']);
    exit;
}

// Fetch HQ image (compressed to 480p for modal)
$select = 'log_id,username,profile_picture';
$path = "rest/v1/accounts?select=" . urlencode($select) . "&log_id=eq." . urlencode($userId);

[$status, $rows, $err] = supabase_request('GET', $path);

$data = null;
if (is_array($rows) && count($rows) > 0) {
    $data = $rows[0];
    if (isset($data['profile_picture']) && !empty($data['profile_picture'])) {
        $img = $data['profile_picture'];
        // Compress to 480p (480px width, 70 quality) to ensure fast load and no memory issues
        $compressedImg = compress_base64_image($img, 480, 70);
        
        if (strpos($compressedImg, 'data:image') !== 0) {
            $data['profile_picture_hq'] = 'data:image/jpeg;base64,' . $compressedImg;
        } else {
            $data['profile_picture_hq'] = $compressedImg;
        }
        // CRITICAL: Remove the original massive string to prevent memory exhaustion and JSON truncation
        unset($data['profile_picture']);
    }
}

// Clean any accidental output/BOM before echoing JSON
if (ob_get_level() > 0) {
    ob_end_clean();
}

echo json_encode([
    'ok' => $status >= 200 && $status < 300 && $data !== null,
    'status' => $status,
    'error' => $err ?: ($data === null ? 'User not found' : null),
    'user' => $data,
]);
