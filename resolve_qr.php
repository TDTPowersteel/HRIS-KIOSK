<?php
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

// Expected format: LOG_ID:<id>, LOGID:<id>, or USER:<username>|HASH:<...>|TIME:<...>
$logId = null;
$username = null;
if (preg_match('/(?:LOG_?ID|USER):([^|]+)/i', $qr, $m)) {
    $value = trim($m[1]);
    if (preg_match('/LOG_?ID:/i', $qr)) {
        $logId = $value;
    } else {
        $username = $value;
    }
}

if (!$logId && !$username) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'message' => 'Invalid QR format (missing LOGID or USER)']);
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
$role = null;
$gender = null;
$birthday = null;
$address = null;
$phone = null;
$email = null;
$department = null;
$openSession = null;
$face = null;
$faceEmbedding = null;

if ($resolvedLogId) {
    // First get basic employee data
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

        // Check for ANY open attendance session (timeout IS NULL)
        // We remove the today filter so that if someone forgot to clock out yesterday,
        // the kiosk will still show "Clock Out" to close that old session first.
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

        // Get department name if dept_id exists
        $department = null;
        if ($deptId) {

            // Try the actual departments table schema you showed: dept_id key and name column.
            $deptQueries = [
                "rest/v1/departments?dept_id=eq." . urlencode($deptId) . "&select=name",
                "rest/v1/department?dept_id=eq." . urlencode($deptId) . "&select=name"
            ];

            foreach ($deptQueries as $index => $query) {
                [$s3, $deptRows, $e3] = supabase_request('GET', $query);

                if (!$e3 && is_array($deptRows) && count($deptRows) > 0) {
                    $department = normalize_value($deptRows[0]['name'] ?? null);
                    break; // Stop trying other queries once we find a match
                }
            }

        } else {
        }

        // Get profile picture and face
        [$s4, $accountRows, $e4] = supabase_request(
            'GET',
            "rest/v1/accounts?log_id=eq." . urlencode($resolvedLogId) . "&select=profile_picture,face,face_embedding"
        );
        $profilePicture = null;
        $face = null;
        if (!$e4 && is_array($accountRows) && count($accountRows) > 0) {
            $profilePicture = normalize_value($accountRows[0]['profile_picture'] ?? null);
            $face = normalize_value($accountRows[0]['face'] ?? null);
            $faceEmbedding = normalize_value($accountRows[0]['face_embedding'] ?? null);
        }

    } else {
    }
}

$jsonResponse = json_encode([
    'ok' => true,
    'user' => [
        'log_id' => $resolvedLogId,
        'username' => $resolvedUsername,
        'name' => $displayName,
        'profile_picture' => $profilePicture,
        'face' => $face,
        'face_embedding' => $faceEmbedding,
        'role' => $role,
        'department' => $department,
        'open_session' => $openSession,
    ],
]);

header('Content-Length: ' . strlen($jsonResponse));
echo $jsonResponse;

if (ob_get_level()) {
    ob_end_flush();
}
