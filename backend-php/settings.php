<?php
ini_set('display_errors', '0');
ini_set('display_startup_errors', '0');
error_reporting(E_ALL);

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, Accept');
header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

require_once __DIR__ . '/connect.php';
require_once __DIR__ . '/settings_store.php';

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    echo json_encode([
        'ok' => true,
        'settings' => settings_get_public_data(),
        'kiosk_mode' => defined('KIOSK_MODE') ? KIOSK_MODE : 'employee'
    ]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'message' => 'Method not allowed']);
    exit;
}

$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'message' => 'Invalid JSON body']);
    exit;
}

$action = trim((string)($input['action'] ?? ''));
$settings = settings_ensure_store();

if ($action === 'set_location') {
    $latitude = isset($input['latitude']) ? (float)$input['latitude'] : null;
    $longitude = isset($input['longitude']) ? (float)$input['longitude'] : null;

    if ($latitude === null || $longitude === null) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'message' => 'Latitude and longitude are required']);
        exit;
    }

    $settings['attendance_location'] = [
        'latitude' => $latitude,
        'longitude' => $longitude,
    ];

    if (!settings_save($settings)) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'message' => 'Failed to save attendance location']);
        exit;
    }

    echo json_encode([
        'ok' => true,
        'message' => 'Attendance location updated',
        'settings' => settings_get_public_data(),
    ]);
    exit;
}

if ($action === 'set_interval') {
    $interval = isset($input['interval_minutes']) ? (int)$input['interval_minutes'] : 0;
    if ($interval < 1 || $interval > 1440) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'message' => 'Interval must be between 1 and 1440 minutes']);
        exit;
    }

    $settings['attendance_interval_minutes'] = $interval;
    if (!settings_save($settings)) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'message' => 'Failed to save attendance interval']);
        exit;
    }

    echo json_encode([
        'ok' => true,
        'message' => 'Attendance interval updated',
        'settings' => settings_get_public_data(),
    ]);
    exit;
}

if ($action === 'change_admin_password') {
    $currentPassword = (string)($input['current_password'] ?? '');
    $newPassword = (string)($input['new_password'] ?? '');

    if ($currentPassword === '' || $newPassword === '') {
        http_response_code(400);
        echo json_encode(['ok' => false, 'message' => 'Current password and new password are required']);
        exit;
    }

    if (strlen($newPassword) < 4) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'message' => 'New password must be at least 4 characters']);
        exit;
    }

    $hash = (string)($settings['admin_password_hash'] ?? '');
    if ($hash === '' || !password_verify($currentPassword, $hash)) {
        http_response_code(401);
        echo json_encode(['ok' => false, 'message' => 'Current admin password is incorrect']);
        exit;
    }

    $settings['admin_password_hash'] = password_hash($newPassword, PASSWORD_DEFAULT);
    if (!settings_save($settings)) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'message' => 'Failed to update admin password']);
        exit;
    }

    echo json_encode([
        'ok' => true,
        'message' => 'Admin password updated',
        'settings' => settings_get_public_data(),
    ]);
    exit;
}

http_response_code(400);
echo json_encode(['ok' => false, 'message' => 'Unknown action']);
