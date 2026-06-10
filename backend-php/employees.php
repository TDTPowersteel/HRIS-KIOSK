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
    if (defined('KIOSK_MODE') && KIOSK_MODE === 'intern') {
        $internId = (int)preg_replace('/^intern_/', '', $detailId);
        $db = getImsConnection();
        $stmt = $db->prepare("SELECT i.id, i.first_name, i.last_name, i.email, i.profile_photo, i.face_embedding, d.name AS dept_name
                              FROM interns i
                              LEFT JOIN departments d ON i.department_id = d.id
                              WHERE i.id = ? AND i.status = 'Active'");
        $status = 404;
        $user = null;
        $profile_picture_hq = null;
        $err = 'Intern not found';
        
        if ($stmt !== false) {
            $stmt->bind_param('i', $internId);
            if ($stmt->execute()) {
                $row = $stmt->get_result()->fetch_assoc();
                if ($row) {
                    $scheme = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on' ? 'https' : 'http');
                    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
                    $profilePhotoUrl = null;
                    if (!empty($row['profile_photo'])) {
                        $imsUrl = getenv('IMS_URL') ?: null;
                        if (!empty($imsUrl)) {
                            $profilePhotoUrl = rtrim($imsUrl, '/') . "/uploads/photos/" . $row['profile_photo'];
                        } else {
                            if (preg_match('/:80\d\d$/', $host)) {
                                $imsHost = preg_replace('/:80\d\d$/', ':8002', $host);
                                $profilePhotoUrl = "{$scheme}://{$imsHost}/uploads/photos/" . $row['profile_photo'];
                            } else {
                                $profilePhotoUrl = "{$scheme}://{$host}/ims/uploads/photos/" . $row['profile_photo'];
                            }
                        }
                    }
                    
                    $faceEmbedding = null;
                    $hasFaceRegistered = !empty($row['face_embedding']);
                    if ($hasFaceRegistered) {
                        $faceEmbedding = json_decode($row['face_embedding'], true);
                    }
                    
                    $user = [
                        'emp_id' => 'intern_' . $row['id'],
                        'name' => $row['first_name'] . ' ' . $row['last_name'],
                        'role' => 'Intern',
                        'dept_id' => null,
                        'log_id' => 'intern_' . $row['id'],
                        'face_embedding' => $faceEmbedding,
                        'has_face_registered' => $hasFaceRegistered,
                        'departments' => [
                            'name' => $row['dept_name'] ?? 'Internship'
                        ],
                        'accounts' => [
                            'log_id' => 'intern_' . $row['id'],
                            'username' => 'intern_' . $row['id'],
                            'qr_code' => 'TDTINTRN' . $row['id'],
                            'profile_picture' => $profilePhotoUrl,
                            'face_embedding' => $faceEmbedding,
                            'has_face_registered' => $hasFaceRegistered
                        ]
                    ];
                    $profile_picture_hq = $profilePhotoUrl;
                    $status = 200;
                    $err = null;
                }
            } else {
                $status = 500;
                $err = $stmt->error;
            }
            $stmt->close();
        } else {
            $status = 500;
            $err = $db->error;
        }

        if (ob_get_level() > 0) ob_end_clean();

        echo json_encode([
            'ok' => $status >= 200 && $status < 300 && $user !== null,
            'status' => $status,
            'error' => $err,
            'user' => $user,
            'profile_picture_hq' => $profile_picture_hq 
        ]);
        exit;
    }

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
            $imgPath = "rest/v1/accounts?select=profile_picture,face_embedding&log_id=eq." . urlencode((string)$logId);
            [$imgStatus, $imgRows, $imgErr] = supabase_request('GET', $imgPath);
            
            $hasFace = false;
            if (is_array($imgRows) && count($imgRows) > 0) {
                $rawImg = $imgRows[0]['profile_picture'] ?? null;
                $rawFace = $imgRows[0]['face_embedding'] ?? null;
                $hasFace = !empty($rawFace);
                if ($rawImg && !empty($rawImg)) {
                    // Hyper-optimized for Modal stability: 500px width at 70% quality
                    $compressedImg = compress_base64_image($rawImg, 500, 70);
                    
                    if (strpos($compressedImg, 'data:image') !== 0) {
                        $profile_picture_hq = 'data:image/jpeg;base64,' . $compressedImg;
                    } else {
                        $profile_picture_hq = $compressedImg;
                    }
                }
                unset($imgRows);
            }
            $user['has_face_registered'] = $hasFace;
        }
    }

    if (ob_get_level() > 0) ob_end_clean();

    echo json_encode([
        'ok' => $status >= 200 && $status < 300 && $user !== null,
        'status' => $status,
        'error' => $err ?: ($user === null ? 'User not found' : null),
        'user' => $user,
        'profile_picture_hq' => $profile_picture_hq,
        'kiosk_mode' => defined('KIOSK_MODE') ? KIOSK_MODE : 'employee'
    ]);
    exit;
}

// --- List Mode ---
$page = isset($_GET['page']) ? (int)$_GET['page'] : 0;
$limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 1000;
$offset = $page * $limit;

$search = isset($_GET['search']) ? trim($_GET['search']) : null;

if (defined('KIOSK_MODE') && KIOSK_MODE === 'intern') {
    $db = getImsConnection();
    
    $sql = "SELECT i.id, i.first_name, i.last_name, i.email, i.profile_photo, i.face_embedding, d.name AS dept_name
            FROM interns i
            LEFT JOIN departments d ON i.department_id = d.id
            WHERE i.status = 'Active'";
            
    if ($search !== null && $search !== '') {
        $sql .= " AND (CONCAT(i.first_name, ' ', i.last_name) LIKE ? OR d.name LIKE ? OR i.email LIKE ?)";
    }
    
    $sql .= " ORDER BY i.id LIMIT ? OFFSET ?";
    
    $stmt = $db->prepare($sql);
    if ($stmt === false) {
        $status = 500;
        $data = null;
        $err = $db->error;
    } else {
        if ($search !== null && $search !== '') {
            $likeSearch = '%' . $search . '%';
            $stmt->bind_param('sssii', $likeSearch, $likeSearch, $likeSearch, $limit, $offset);
        } else {
            $stmt->bind_param('ii', $limit, $offset);
        }
        
        if ($stmt->execute()) {
            $result = $stmt->get_result();
            $data = [];
            $scheme = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on' ? 'https' : 'http');
            $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
            
            while ($row = $result->fetch_assoc()) {
                $profilePhotoUrl = null;
                if (!empty($row['profile_photo'])) {
                    $profilePhotoUrl = "{$scheme}://{$host}/ims/uploads/photos/" . $row['profile_photo'];
                }
                
                $faceEmbedding = null;
                $hasFaceRegistered = !empty($row['face_embedding']);
                if ($hasFaceRegistered) {
                    $faceEmbedding = json_decode($row['face_embedding'], true);
                }
                
                $data[] = [
                    'emp_id' => 'intern_' . $row['id'],
                    'name' => $row['first_name'] . ' ' . $row['last_name'],
                    'role' => 'Intern',
                    'dept_id' => null,
                    'log_id' => 'intern_' . $row['id'],
                    'face_embedding' => $faceEmbedding,
                    'has_face_registered' => $hasFaceRegistered,
                    'departments' => [
                        'name' => $row['dept_name'] ?? 'Internship'
                    ],
                    'accounts' => [
                        'log_id' => 'intern_' . $row['id'],
                        'username' => 'intern_' . $row['id'],
                        'qr_code' => 'TDTINTRN' . $row['id'],
                        'profile_picture' => $profilePhotoUrl,
                        'face_embedding' => $faceEmbedding,
                        'has_face_registered' => $hasFaceRegistered
                    ]
                ];
            }
            $status = 200;
            $err = null;
        } else {
            $status = 500;
            $data = null;
            $err = $stmt->error;
        }
        $stmt->close();
    }
} else {
    $select = 'emp_id,name,role,dept_id,log_id,accounts!log_id(log_id,username,qr_code,profile_picture,face_embedding),departments(name)';
    $path = "rest/v1/employees?select={$select}&order=emp_id&limit={$limit}&offset={$offset}";

    if (!empty($search)) {
        $searchEscaped = urlencode('%' . $search . '%');
        $path .= "&or=(name.ilike.{$searchEscaped},role.ilike.{$searchEscaped},accounts!log_id.username.ilike.{$searchEscaped})";
    }

    [$status, $data, $err] = supabase_request('GET', $path);

    // Compress profile pictures to save mobile storage
    if (is_array($data)) {
        foreach ($data as &$employee) {
            $hasFace = false;
            if (isset($employee['accounts'])) {
                if (isset($employee['accounts']['profile_picture'])) {
                    $img = $employee['accounts']['profile_picture'];
                    if ($img && strlen($img) > 100) {
                        $employee['accounts']['profile_picture'] = compress_base64_image($img, 500, 70);
                    }
                    $hasFace = !empty($employee['accounts']['face_embedding']);
                    $employee['accounts']['has_face_registered'] = $hasFace;
                } else if (is_array($employee['accounts'])) {
                    foreach ($employee['accounts'] as &$account) {
                        if (isset($account['profile_picture'])) {
                            $img = $account['profile_picture'];
                            if ($img && strlen($img) > 100) {
                                $account['profile_picture'] = compress_base64_image($img, 500, 70);
                            }
                        }
                        $accountHasFace = !empty($account['face_embedding']);
                        $account['has_face_registered'] = $accountHasFace;
                        if ($accountHasFace) {
                            $hasFace = true;
                        }
                    }
                }
            }
            $employee['has_face_registered'] = $hasFace;
        }
    }
}

if (ob_get_level() > 0) ob_end_clean();

echo json_encode([
    'ok' => $status >= 200 && $status < 300,
    'status' => $status,
    'error' => $err,
    'data' => $data,
    'kiosk_mode' => defined('KIOSK_MODE') ? KIOSK_MODE : 'employee'
]);
