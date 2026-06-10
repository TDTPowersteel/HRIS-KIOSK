<?php
date_default_timezone_set('Asia/Manila');
// Resolve QR data to an account (username -> log_id)

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

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, Accept');
header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'message' => 'Method not allowed']);
    exit;
}

require_once __DIR__ . '/connect.php';

$qr = isset($_GET['qr']) ? trim((string) $_GET['qr']) : '';
if ($qr === '') {
    http_response_code(400);
    echo json_encode(['ok' => false, 'message' => 'Missing qr parameter']);
    exit;
}

// Expected format: LOG_ID:<id>, LOGID:<id>, USER:<username>, or TDTINTRN<id>
$logId = null;
$username = null;
if (preg_match('/TDTINTRN([0-9]+)/i', $qr, $m)) {
    $logId = 'intern_' . (int)$m[1];
} else if (preg_match('/(?:LOG_?ID|USER):([^|]+)/i', $qr, $m)) {
    $value = trim($m[1]);
    if (preg_match('/LOG_?ID:/i', $qr)) {
        $logId = $value;
    } else {
        $username = $value;
    }
}

if (!$logId && !$username) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'message' => 'Invalid QR!']);
    exit;
}

if ((defined('KIOSK_MODE') && KIOSK_MODE === 'intern') || strpos($logId ?? '', 'intern_') === 0 || strpos($username ?? '', 'intern_') === 0) {
    $internId = 0;
    if ($logId && strpos($logId, 'intern_') === 0) {
        $internId = (int)str_replace('intern_', '', $logId);
    } else if ($username && strpos($username, 'intern_') === 0) {
        $internId = (int)str_replace('intern_', '', $username);
    } else {
        $internId = (int)($logId ?: $username);
    }

    $db = getImsConnection();
    $stmt = $db->prepare("SELECT i.id, i.first_name, i.last_name, i.email, i.profile_photo, i.face_embedding, d.name AS dept_name
                          FROM interns i
                          LEFT JOIN departments d ON i.department_id = d.id
                          WHERE i.id = ? AND i.status = 'Active'");
    if ($stmt === false) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'message' => 'Database error: ' . $db->error]);
        exit;
    }
    $stmt->bind_param('i', $internId);
    if (!$stmt->execute()) {
        $stmt->close();
        http_response_code(500);
        echo json_encode(['ok' => false, 'message' => 'Database query execution error']);
        exit;
    }
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    if (!$row) {
        http_response_code(404);
        echo json_encode(['ok' => false, 'message' => 'Intern not found']);
        exit;
    }

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
    if (!empty($row['face_embedding'])) {
        $faceEmbedding = json_decode($row['face_embedding'], true);
    }

    // Check for open attendance session in MySQL
    $openSession = null;
    $todayDate = date('Y-m-d');
    $attStmt = $db->prepare("SELECT id, entry_date, time_in, time_out 
                             FROM dtr_entries 
                             WHERE intern_id = ? AND time_out IS NULL AND is_archived = 0 
                             ORDER BY id DESC LIMIT 1");
    if ($attStmt !== false) {
        $attStmt->bind_param('i', $internId);
        if ($attStmt->execute()) {
            $attRow = $attStmt->get_result()->fetch_assoc();
            if ($attRow) {
                $openSession = [
                    'att_id' => $attRow['id'],
                    'timein' => $attRow['time_in'],
                    'date' => $attRow['entry_date']
                ];
            }
        }
        $attStmt->close();
    }

    $jsonResponse = json_encode([
        'ok' => true,
        'user' => [
            'log_id' => 'intern_' . $row['id'],
            'username' => 'intern_' . $row['id'],
            'name' => $row['first_name'] . ' ' . $row['last_name'],
            'profile_picture' => $profilePhotoUrl,
            'face_embedding' => $faceEmbedding,
            'role' => 'Intern',
            'department' => $row['dept_name'] ?? 'Internship',
            'open_session' => $openSession
        ]
    ]);
    header('Content-Length: ' . strlen($jsonResponse));
    echo $jsonResponse;
    if (ob_get_level()) ob_end_flush();
    exit;
}

if ($logId) {
    [$status, $data, $err] = supabase_request(
        'GET',
        "rest/v1/accounts?log_id=eq." . urlencode($logId) . "&select=log_id,username"
    );
} else {
    [$status, $data, $err] = supabase_request(
        'GET',
        "rest/v1/accounts?username=eq." . urlencode($username) . "&select=log_id,username"
    );

    // Fall back to a case-insensitive scan if the exact username casing doesn't match.
    if ((!$err && (!is_array($data) || count($data) === 0)) || $status === 404) {
        [$allStatus, $allRows, $allErr] = supabase_request(
            'GET',
            "rest/v1/accounts?select=log_id,username&limit=1000"
        );

        if (!$allErr && is_array($allRows) && count($allRows) > 0) {
            $match = null;
            $needle = strtolower(trim((string) $username));
            foreach ($allRows as $row) {
                $rowUsername = strtolower(trim((string) ($row['username'] ?? '')));
                if ($needle !== '' && $rowUsername === $needle) {
                    $match = $row;
                    break;
                }
            }

            if ($match) {
                $status = 200;
                $data = [$match];
                $err = null;
            }
        }
    }
}

if ($err) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'message' => 'Database error', 'detail' => $err]);
    exit;
}

if ($status !== 200 || !is_array($data) || count($data) === 0) {
    http_response_code(404);
    echo json_encode(['ok' => false, 'message' => 'Account not found']);
    exit;
}

$resolvedLogId = $data[0]['log_id'] ?? null;
$resolvedUsername = $data[0]['username'] ?? $username;

function normalize_value($value)
{
    if ($value === null || $value === false || $value === '') {
        return null;
    }
    $text = trim((string) $value);
    return $text === '' ? null : $text;
}

$displayName = null;
$profilePicture = null;
$faceEmbedding = null;
$role = null;
$gender = null;
$birthday = null;
$address = null;
$phone = null;
$email = null;
$department = null;
$openSession = null;

if ($resolvedLogId) {
    // Fetch profile picture and face_embedding (for Camera Vision)
    // We fetch these from accounts table FIRST to ensure availability regardless of employees record state.
    $selectCols = "profile_picture,face_embedding";

    [$s4, $accountRows, $e4] = supabase_request(
        'GET',
        "rest/v1/accounts?log_id=eq." . urlencode($resolvedLogId) . "&select=" . $selectCols
    );
    if (!$e4 && is_array($accountRows) && count($accountRows) > 0) {
        $account = $accountRows[0];
        $profilePicture = normalize_value($account['profile_picture'] ?? null);
        
        $rawEmbedding = $account['face_embedding'] ?? null;
        if ($rawEmbedding !== null) {
            if (is_array($rawEmbedding) || is_object($rawEmbedding)) {
                $faceEmbedding = json_encode($rawEmbedding);
            } else if (is_string($rawEmbedding)) {
                $trimmed = trim($rawEmbedding);
                if (strpos($trimmed, '[') === 0) {
                    $faceEmbedding = $trimmed;
                } else {
                    $faceEmbedding = $trimmed;
                }
            }
        }
    }

    // Now get basic employee data
    $employeeQuery = "rest/v1/employees?log_id=eq." . urlencode($resolvedLogId) . "&select=emp_id,name,role,dept_id";

    [$s2, $empRows, $e2] = supabase_request(
        'GET',
        $employeeQuery
    );

    if (!$e2 && is_array($empRows) && count($empRows) > 0) {
        $employee = $empRows[0];
        $empId = $employee['emp_id'] ?? null;

        $displayName = normalize_value($employee['name'] ?? null);
        $role = normalize_value($employee['role'] ?? null);
        $deptId = $employee['dept_id'] ?? null;

        // Check for ANY open attendance session
        if ($empId) {
            $attQuery = "rest/v1/attendance?emp_id=eq." . urlencode($empId) . "&timeout=is.null&order=att_id.desc&limit=1&select=att_id,timein,date";
            [$sAtt, $attRows, $eAtt] = supabase_request('GET', $attQuery);

            if (!$eAtt && is_array($attRows) && count($attRows) > 0) {
                $openSession = [
                    'att_id' => $attRows[0]['att_id'],
                    'timein' => $attRows[0]['timein'],
                    'date' => $attRows[0]['date']
                ];
            }
        }

        // Get department name
        $department = null;
        if ($deptId) {
            $deptQueries = [
                "rest/v1/departments?dept_id=eq." . urlencode($deptId) . "&select=name",
                "rest/v1/department?dept_id=eq." . urlencode($deptId) . "&select=name"
            ];

            foreach ($deptQueries as $query) {
                [$s3, $deptRows, $e3] = supabase_request('GET', $query);
                if (!$e3 && is_array($deptRows) && count($deptRows) > 0) {
                    $department = normalize_value($deptRows[0]['name'] ?? null);
                    break;
                }
            }
        }
    }
}

$jsonResponse = json_encode([
    'ok' => true,
    'user' => [
        'log_id' => $resolvedLogId,
        'username' => $resolvedUsername,
        'name' => $displayName,
        'profile_picture' => $profilePicture,
        'face_embedding' => $faceEmbedding,
        'role' => $role,
        'department' => $department,
        'open_session' => $openSession,
    ],
    'debug' => [
        'resolved_log_id' => $resolvedLogId,
        'has_account_row' => !empty($accountRows),
        'fetch_error' => $e4,
        'raw_embedding_type' => isset($account) ? gettype($account['face_embedding'] ?? null) : 'no_account'
    ]
]);

header('Content-Length: ' . strlen($jsonResponse));
echo $jsonResponse;

if (ob_get_level()) {
    ob_end_flush();
}
