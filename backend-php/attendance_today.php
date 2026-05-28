<?php
header('Access-Control-Allow-Origin: *');
header('Content-Type: application/json; charset=UTF-8');
require_once __DIR__ . '/connect.php';

date_default_timezone_set('Asia/Manila');
$today = date('Y-m-d');

// Fetch today's attendance with joined employee and account info
$select = 'att_id,emp_id,timein,timeout,date,employees(name,log_id,accounts(username,profile_picture))';
$path = "rest/v1/attendance?select=" . urlencode($select) . "&date=eq.{$today}&order=att_id.desc";

[$status, $data, $err] = supabase_request('GET', $path);

if ($err) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'message' => 'Database error', 'detail' => $err]);
    exit;
}

$history = [];
if (is_array($data)) {
    foreach ($data as $row) {
        $emp = $row['employees'] ?? null;
        $acc = $emp['accounts'] ?? null;
        
        // If timeout exists, it's a clock_out record (latest state of that session)
        $history[] = [
            'id' => $row['att_id'],
            'userId' => $emp['log_id'] ?? $row['emp_id'],
            'name' => $emp['name'] ?? 'Unknown',
            'username' => $acc['username'] ?? 'N/A',
            'profilePicture' => $acc['profile_picture'] ?? null,
            'action' => $row['timeout'] ? 'clock_out' : 'clock_in',
            'time' => $row['timeout'] ?: $row['timein'],
            'date' => $row['date']
        ];
    }
}

echo json_encode(['ok' => true, 'history' => $history]);
?>
