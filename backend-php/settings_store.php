<?php

const SETTINGS_STORE_DIR = __DIR__ . '/storage';
define('SETTINGS_STORE_FILE', SETTINGS_STORE_DIR . '/' . (defined('KIOSK_MODE') && KIOSK_MODE === 'intern' ? 'app_settings_intern.json' : 'app_settings.json'));

function settings_default_values(): array
{
    return [
        'attendance_location' => [
            'latitude' => 14.6130261,
            'longitude' => 120.9937274,
        ],
        'attendance_interval_minutes' => 5,
        'admin_password_hash' => password_hash('admin123', PASSWORD_DEFAULT),
        'updated_at' => gmdate('c'),
    ];
}

function settings_ensure_store(): array
{
    if (!is_dir(SETTINGS_STORE_DIR)) {
        @mkdir(SETTINGS_STORE_DIR, 0777, true);
    }

    if (!file_exists(SETTINGS_STORE_FILE)) {
        $defaults = settings_default_values();
        file_put_contents(SETTINGS_STORE_FILE, json_encode($defaults, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
        return $defaults;
    }

    $raw = @file_get_contents(SETTINGS_STORE_FILE);
    $decoded = is_string($raw) ? json_decode($raw, true) : null;
    if (!is_array($decoded)) {
        $defaults = settings_default_values();
        file_put_contents(SETTINGS_STORE_FILE, json_encode($defaults, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
        return $defaults;
    }

    $defaults = settings_default_values();
    return array_replace_recursive($defaults, $decoded);
}

function settings_get_public_data(): array
{
    $settings = settings_ensure_store();
    unset($settings['admin_password_hash']);
    return $settings;
}

function settings_save(array $settings): bool
{
    $settings['updated_at'] = gmdate('c');
    $json = json_encode($settings, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    if ($json === false) {
        return false;
    }

    return file_put_contents(SETTINGS_STORE_FILE, $json, LOCK_EX) !== false;
}
