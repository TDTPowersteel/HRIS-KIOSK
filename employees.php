<?php
// Increase memory limit for large datasets (e.g. many base64 images)
ini_set('memory_limit', '512M');
// Disable errors in output to prevent JSON corruption
ini_set('display_errors', '0');
ini_set('display_startup_errors', '0');
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

// Check for Detail Mode (Fetch single employee with HQ 720p image)
$detailId = isset($_GET['detail_id']) ? $_GET['detail_id'] : null;

if ($detailId) {
    $select = 'emp_id,name,role,dept_id,log_id,accounts(log_id,username,qr_code,profile_picture),departments(name)';
    $path = "rest/v1/employees?select={$select}&emp_id=eq.{$detailId}";
    
    [$status, $data, $err] = supabase_request('GET', $path);
    
    $user = null;
    if (is_array($data) && count($data) > 0) {
        $user = $data[0];
        // Ensure profile_picture is properly handled
        if (isset($user['accounts'])) {
            $isArr = is_array($user['accounts']) && !isset($user['accounts']['profile_picture']);
            $accRef = &$user['accounts'];
            if ($isArr && count($user['accounts']) > 0) {
                $accRef = &$user['accounts'][0];
            }

            if (isset($accRef['profile_picture']) && !empty($accRef['profile_picture'])) {
                $img = $accRef['profile_picture'];
                // Use 480p for safe memory management
                $compressedImg = compress_base64_image($img, 480, 75);
                if (strpos($compressedImg, 'data:image') !== 0) {
                    $user['profile_picture_hq'] = 'data:image/jpeg;base64,' . $compressedImg;
                } else {
                    $user['profile_picture_hq'] = $compressedImg;
                }
                
                // CRITICAL: Unset the original massive image to prevent memory exhaustion and JSON truncation
                if ($isArr) {
                    foreach($user['accounts'] as &$a) unset($a['profile_picture']);
                } else {
                    unset($user['accounts']['profile_picture']);
                }
            }
        }
    }

    if (ob_get_level() > 0) ob_end_clean();

    echo json_encode([
        'ok' => $status >= 200 && $status < 300 && $user !== null,
        'status' => $status,
        'error' => $err ?: ($user === null ? 'User not found' : null),
        'user' => $user,
    ]);
    exit;
}

// Return all employees and their associated account/dept data
$page = isset($_GET['page']) ? (int)$_GET['page'] : 0;
$limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 1000;
$offset = $page * $limit;

$select = 'emp_id,name,role,dept_id,log_id,accounts(log_id,username,qr_code,profile_picture),departments(name)';
$path = "rest/v1/employees?select={$select}&order=emp_id&limit={$limit}&offset={$offset}";

[$status, $data, $err] = supabase_request('GET', $path);

// Compress profile pictures to save mobile storage
if (is_array($data)) {
    foreach ($data as &$employee) {
        if (isset($employee['accounts'])) {
            // Handle both object and array formats
            if (isset($employee['accounts']['profile_picture'])) {
                $img = $employee['accounts']['profile_picture'];
                if ($img && strlen($img) > 100) {
                    // Extreme compression for list view: 80px width, 15% quality
                    // This keeps each entry ~1.5KB, allowing 10k+ employees in 20MB cache.
                    $employee['accounts']['profile_picture'] = compress_base64_image($img, 80, 15);
                }
            } else if (is_array($employee['accounts'])) {
                foreach ($employee['accounts'] as &$account) {
                    if (isset($account['profile_picture'])) {
                        $img = $account['profile_picture'];
                        if ($img && strlen($img) > 100) {
                            $account['profile_picture'] = compress_base64_image($img, 80, 15);
                        }
                    }
                }
            }
        }
    }
}

echo json_encode([
    'ok' => $status >= 200 && $status < 300,
    'status' => $status,
    'error' => $err,
    'data' => $data,
]);
