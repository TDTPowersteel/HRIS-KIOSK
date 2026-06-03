<?php
/**
 * employees.php
 * Unified endpoint for employee directory and detail fetching.
 */

// Start output buffering immediately to catch any accidental output
ob_start();

ini_set('memory_limit', '1024M');
ini_set('display_errors', '0');
ini_set('display_startup_errors', '0');
ini_set('zlib.output_compression', 'Off');
error_reporting(E_ALL);

require_once __DIR__ . '/connect.php';

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type, Authorization, apikey');
header('Access-Control-Allow-Methods: GET, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    ob_end_clean();
    http_response_code(200);
    echo json_encode(['ok' => true]);
    exit;
}

// Check for Detail Mode (Fetch single employee)
$detailId = isset($_GET['detail_id']) ? $_GET['detail_id'] : null;

if ($detailId) {
    // 1. Fetch Metadata first (NO IMAGE here to keep this response tiny)
    $select = 'emp_id,name,role,dept_id,log_id,departments(name)';
    $path = "rest/v1/employees?select=" . urlencode($select) . "&emp_id=eq." . urlencode((string)$detailId);
    
    [$status, $data, $err] = supabase_request('GET', $path);
    
    $user = null;
    $profile_picture_hq = null;

    if (is_array($data) && count($data) > 0) {
        $user = $data[0];
        $logId = $user['log_id'];
        unset($data);

        // 2. Fetch Image separately ONLY if user was found
        if ($logId) {
            $imgPath = "rest/v1/accounts?select=profile_picture&log_id=eq." . urlencode((string)$logId);
            [$imgStatus, $imgRows, $imgErr] = supabase_request('GET', $imgPath);
            
            if (is_array($imgRows) && count($imgRows) > 0) {
                $rawImg = $imgRows[0]['profile_picture'] ?? null;
                if ($rawImg && !empty($rawImg)) {
                    // Hyper-optimized for Modal stability: 500px width at 70% quality
                    // This ensures the response is small enough to fit in any buffer
                    $compressedImg = compress_base64_image($rawImg, 500, 70);
                    
                    if (strpos($compressedImg, 'data:image') !== 0) {
                        $profile_picture_hq = 'data:image/jpeg;base64,' . $compressedImg;
                    } else {
                        $profile_picture_hq = $compressedImg;
                    }
                }
                unset($imgRows);
            }
        }
    }

    if (ob_get_level() > 0) ob_end_clean();

    echo json_encode([
        'ok' => $status >= 200 && $status < 300 && $user !== null,
        'status' => $status,
        'error' => $err ?: ($user === null ? 'User not found' : null),
        'user' => $user,
        'profile_picture_hq' => $profile_picture_hq 
    ]);
    exit;
}

// --- List Mode ---
$page = isset($_GET['page']) ? (int)$_GET['page'] : 0;
$limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 1000;
$offset = $page * $limit;

$search = isset($_GET['search']) ? trim($_GET['search']) : null;

$select = 'emp_id,name,role,dept_id,log_id,accounts!log_id(log_id,username,qr_code,profile_picture),departments(name)';
$path = "rest/v1/employees?select={$select}&order=emp_id&limit={$limit}&offset={$offset}";

if (!empty($search)) {
    $searchEscaped = urlencode('%' . $search . '%');
    $path .= "&or=(name.ilike.{$searchEscaped},role.ilike.{$searchEscaped},accounts!log_id.username.ilike.{$searchEscaped})";
}

[$status, $data, $err] = supabase_request('GET', $path);

// Compress profile pictures to save mobile storage
if (is_array($data)) {
    foreach ($data as &$employee) {
        if (isset($employee['accounts'])) {
            if (isset($employee['accounts']['profile_picture'])) {
                $img = $employee['accounts']['profile_picture'];
                if ($img && strlen($img) > 100) {
                    // 500px width, 70% quality for direct use in modals without re-fetching
                    $employee['accounts']['profile_picture'] = compress_base64_image($img, 500, 70);
                }
            } else if (is_array($employee['accounts'])) {
                foreach ($employee['accounts'] as &$account) {
                    if (isset($account['profile_picture'])) {
                        $img = $account['profile_picture'];
                        if ($img && strlen($img) > 100) {
                            $account['profile_picture'] = compress_base64_image($img, 500, 70);
                        }
                    }
                }
            }
        }
    }
}

if (ob_get_level() > 0) ob_end_clean();

echo json_encode([
    'ok' => $status >= 200 && $status < 300,
    'status' => $status,
    'error' => $err,
    'data' => $data,
]);
