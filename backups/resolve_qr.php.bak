<?php
// Resolve QR data to an account (username -> log_id)

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

if ($resolvedLogId) {
    // First get basic employee data
    $employeeQuery = "rest/v1/employees?log_id=eq." . urlencode($resolvedLogId) . "&select=name,role,dept_id";
    error_log("resolve_qr.php: DEBUG - Employee query URL: $employeeQuery");

    [$s2, $empRows, $e2] = supabase_request(
        'GET',
        $employeeQuery
    );

    error_log("resolve_qr.php: DEBUG - Employee query raw response: " . json_encode($empRows));
    error_log("resolve_qr.php: Basic employee query - Status: $s2, Error: " . ($e2 ?: 'none') . ", Rows: " . count($empRows ?? []));

    // Debug: Get all departments to see table structure
    error_log("resolve_qr.php: DEBUG - Getting all departments to check table structure");
    $tableQueries = [
        "rest/v1/departments?select=*&limit=10",
        "rest/v1/department?select=*&limit=10"
    ];

    foreach ($tableQueries as $index => $query) {
        error_log("resolve_qr.php: DEBUG - Trying table query " . ($index + 1) . ": $query");
        [$allDeptStatus, $allDeptRows, $allDeptError] = supabase_request('GET', $query);
        error_log("resolve_qr.php: DEBUG - Table query " . ($index + 1) . " status: $allDeptStatus, error: " . ($allDeptError ?: 'none') . ", rows: " . count($allDeptRows ?? []));

        if ($allDeptRows && count($allDeptRows) > 0) {
            error_log("resolve_qr.php: DEBUG - Found table with query " . ($index + 1));
            error_log("resolve_qr.php: DEBUG - Sample department row: " . json_encode($allDeptRows[0]));
            error_log("resolve_qr.php: DEBUG - Department table columns: " . implode(', ', array_keys($allDeptRows[0])));
            error_log("resolve_qr.php: DEBUG - First 3 departments: " . json_encode(array_slice($allDeptRows, 0, 3)));
            break;
        }
    }

    if ($empRows && count($empRows) > 0) {
        $employee = $empRows[0];
        error_log("resolve_qr.php: DEBUG - Employee data: " . json_encode($employee));
        error_log("resolve_qr.php: DEBUG - Employee keys: " . implode(', ', array_keys($employee)));
        error_log("resolve_qr.php: DEBUG - dept_id value: " . ($employee['dept_id'] ?? 'NOT SET'));
        error_log("resolve_qr.php: DEBUG - dept_id type: " . gettype($employee['dept_id'] ?? null));
    }

    if (!$e2 && is_array($empRows) && count($empRows) > 0) {
        $employee = $empRows[0];
        error_log("resolve_qr.php: Basic employee data: " . json_encode($employee));

        $displayName = normalize_value($employee['name'] ?? null);
        $role = normalize_value($employee['role'] ?? null);
        $deptId = $employee['dept_id'] ?? null;

        error_log("resolve_qr.php: DEBUG - employee array keys: " . implode(", ", array_keys($employee)));
        error_log("resolve_qr.php: DEBUG - dept_id value: " . var_export($deptId, true));
        error_log("resolve_qr.php: DEBUG - dept_id type: " . gettype($deptId));
        error_log("resolve_qr.php: DEBUG - dept_id is_null: " . var_export(is_null($deptId), true));
        error_log("resolve_qr.php: DEBUG - dept_id is_empty: " . var_export(empty($deptId), true));

        // Get department name if dept_id exists
        $department = null;
        if ($deptId) {
            error_log("resolve_qr.php: DEBUG - Looking up department with id: '$deptId'");

            // Try the actual departments table schema you showed: dept_id key and name column.
            $deptQueries = [
                "rest/v1/departments?dept_id=eq." . urlencode($deptId) . "&select=name",
                "rest/v1/department?dept_id=eq." . urlencode($deptId) . "&select=name"
            ];

            foreach ($deptQueries as $index => $query) {
                error_log("resolve_qr.php: DEBUG - Trying department query " . ($index + 1) . ": $query");
                [$s3, $deptRows, $e3] = supabase_request('GET', $query);
                error_log("resolve_qr.php: DEBUG - Query " . ($index + 1) . " status: $s3, error: " . ($e3 ?: 'none') . ", rows: " . count($deptRows ?? []));

                if (!$e3 && is_array($deptRows) && count($deptRows) > 0) {
                    error_log("resolve_qr.php: DEBUG - Found department with query " . ($index + 1) . ": " . json_encode($deptRows[0]));
                    $department = normalize_value($deptRows[0]['name'] ?? null);
                    break; // Stop trying other queries once we find a match
                }
            }

            error_log("resolve_qr.php: Department query - dept_id: $deptId, department: '$department'");
        } else {
            error_log("resolve_qr.php: DEBUG - dept_id is empty or null");
        }

        // Get profile picture
        [$s4, $accountRows, $e4] = supabase_request(
            'GET',
            "rest/v1/accounts?log_id=eq." . urlencode($resolvedLogId) . "&select=profile_picture"
        );
        $profilePicture = null;
        if (!$e4 && is_array($accountRows) && count($accountRows) > 0) {
            $profilePicture = normalize_value($accountRows[0]['profile_picture'] ?? null);
        }
        error_log("resolve_qr.php: Account query - profile_picture: '$profilePicture'");

        error_log("resolve_qr.php: Final processed values - name: '$displayName', role: '$role', department: '$department', profile_picture: '$profilePicture'");
    } else {
        error_log("resolve_qr.php: No employee data found for log_id: $resolvedLogId");
    }
}

echo json_encode([
    'ok' => true,
    'user' => [
        'log_id' => $resolvedLogId,
        'username' => $resolvedUsername,
        'name' => $displayName,
        'profile_picture' => $profilePicture,
        'role' => $role,
        'department' => $department,
    ],
]);

error_log("resolve_qr.php: Final response: " . json_encode([
    'ok' => true,
    'user' => [
        'log_id' => $resolvedLogId,
        'username' => $resolvedUsername,
        'name' => $displayName,
        'profile_picture' => $profilePicture,
        'role' => $role,
        'department' => $department,
    ],
]));

if (ob_get_level()) {
    ob_end_flush();
}
