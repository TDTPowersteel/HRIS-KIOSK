<?php
header('Access-Control-Allow-Origin: *');
header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-cache, no-store, must-revalidate');
header('Pragma: no-cache');
header('Expires: 0');
require_once __DIR__ . '/connect.php';

date_default_timezone_set('Asia/Manila');
$today = date('Y-m-d');

if (defined('KIOSK_MODE') && KIOSK_MODE === 'intern') {
    $db = getImsConnection();
    $query = "SELECT d.id, d.intern_id, d.entry_date, d.time_in, d.time_out, i.first_name, i.last_name, i.profile_photo
              FROM dtr_entries d
              LEFT JOIN interns i ON d.intern_id = i.id
              WHERE d.entry_date = ? AND d.is_archived = 0
              ORDER BY d.id DESC";
    $stmt = $db->prepare($query);
    if ($stmt !== false) {
        $stmt->bind_param('s', $today);
        if ($stmt->execute()) {
            $res = $stmt->get_result();
            $history = [];
            $scheme = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on' ? 'https' : 'http');
            $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
            while ($row = $res->fetch_assoc()) {
                $profilePhotoUrl = null;
                if (!empty($row['profile_photo'])) {
                    $profilePhotoUrl = "{$scheme}://{$host}/ims/uploads/photos/" . $row['profile_photo'];
                }
                $history[] = [
                    'id' => $row['id'],
                    'emp_id' => 'intern_' . $row['intern_id'],
                    'name' => $row['first_name'] . ' ' . $row['last_name'],
                    'username' => 'intern_' . $row['intern_id'],
                    'profilePicture' => $profilePhotoUrl,
                    'timein' => $row['time_in'],
                    'timeout' => $row['time_out'],
                    'action' => $row['time_out'] ? 'clock_out' : 'clock_in',
                    'time' => $row['time_out'] ?: $row['time_in'],
                    'date' => $row['entry_date']
                ];
            }
            $stmt->close();
            echo json_encode(['ok' => true, 'history' => $history]);
            exit;
        }
        $stmt->close();
    }
    http_response_code(500);
    echo json_encode(['ok' => false, 'message' => 'Failed to load intern logs']);
    exit;
}

// Fetch today's attendance with joined employee and account info
$select = 'att_id,emp_id,timein,timeout,date,employees(name,log_id,accounts!log_id(username,profile_picture))';
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
            'emp_id' => $row['emp_id'],
            'name' => $emp['name'] ?? 'Unknown',
            'username' => $acc['username'] ?? 'N/A',
            'profilePicture' => $acc['profile_picture'] ?? null,
            'timein' => $row['timein'],
            'timeout' => $row['timeout'],
            'action' => $row['timeout'] ? 'clock_out' : 'clock_in',
            'time' => $row['timeout'] ?: $row['timein'],
            'date' => $row['date']
        ];
    }
}

echo json_encode(['ok' => true, 'history' => $history]);
?>