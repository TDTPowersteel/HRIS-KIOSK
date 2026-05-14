<?php
// Increase memory limit for large datasets (e.g. many base64 images)
ini_set('memory_limit', '256M');
// Enable errors temporarily to catch fatal crashes in the output
ini_set('display_errors', '1');
ini_set('display_startup_errors', '1');
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

// Only return employees that have a matching account via log_id
$select = 'emp_id,name,role,dept_id,log_id,accounts!inner(log_id,username,qr_code,profile_picture),departments(name)';
$path = "rest/v1/employees?select={$select}&order=emp_id&limit=1000";

[$status, $data, $err] = supabase_request('GET', $path);

echo json_encode([
    'ok' => $status >= 200 && $status < 300,
    'status' => $status,
    'error' => $err,
    'data' => $data,
]);
