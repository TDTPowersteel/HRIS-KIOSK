<?php
// Supabase "database connection" helper file.
ini_set('display_errors', '0');
ini_set('display_startup_errors', '0');
ini_set('memory_limit', '512M');
error_reporting(E_ALL);

/**
 * Load .env file manually
 */
function loadEnv($dir)
{
    $envFile = $dir . '/.env';
    if (is_file($envFile) && is_readable($envFile)) {
        $lines = file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        foreach ($lines as $line) {
            $line = trim($line);
            if ($line === '' || strpos($line, '#') === 0)
                continue;

            $parts = explode('=', $line, 2);
            if (count($parts) === 2) {
                $key = trim($parts[0]);
                $value = trim($parts[1]);

                // Remove quotes if present
                if (preg_match('/^["\'](.*)["\']$/', $value, $matches)) {
                    $value = $matches[1];
                }

                if (!empty($key)) {
                    putenv("$key=$value");
                    $_ENV[$key] = $value;
                }
            }
        }
    }
}

// Load .env from possible locations
loadEnv(__DIR__ . '/..');
loadEnv(__DIR__);

// --- Supabase config ---
// Prioritize environment variables. Never hardcode sensitive keys in production.
$supabaseUrl = getenv('SUPABASE_URL') ?: 'YOUR_SUPABASE_URL_HERE';
$supabaseAnonKey = getenv('SUPABASE_ANON_KEY') ?: 'YOUR_SUPABASE_ANON_KEY_HERE';
$supabaseServiceKey = getenv('SUPABASE_SERVICE_ROLE_KEY');

define('SUPABASE_URL', $supabaseUrl);
define('SUPABASE_API_KEY', $supabaseServiceKey ?: $supabaseAnonKey);

/**
 * Supabase helper function for making REST API requests
 */
function supabase_request(string $method, string $path, ?array $body = null, array $extraHeaders = []): array
{
    $url = rtrim(SUPABASE_URL, '/') . '/' . ltrim($path, '/');

    if (function_exists('curl_init')) {
        $ch = curl_init($url);

        $headers = array_merge([
            'Content-Type: application/json',
            'apikey: ' . SUPABASE_API_KEY,
            'Authorization: Bearer ' . SUPABASE_API_KEY,
        ], $extraHeaders);

        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST => strtoupper($method),
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
        ]);

        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
        }

        $responseBody = curl_exec($ch);
        $statusCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErr = curl_error($ch);
        $curlErrNo = curl_errno($ch);

        if ($curlErr) {
            $errorMsg = "Supabase curl error ($curlErrNo): $curlErr";
            error_log($errorMsg);
            return [$statusCode ?: 0, null, $errorMsg];
        }
    } else {
        // Fallback to file_get_contents
        $headers = [
            'Content-Type: application/json',
            'apikey: ' . SUPABASE_API_KEY,
            'Authorization: Bearer ' . SUPABASE_API_KEY,
        ];
        $headers = array_merge($headers, $extraHeaders);

        $content = null;
        if ($body !== null) {
            $content = json_encode($body);
            $headers[] = 'Content-Length: ' . strlen($content);
        }

        $options = [
            'http' => [
                'method' => strtoupper($method),
                'header' => implode("\r\n", $headers),
                'ignore_errors' => true,
                'timeout' => 20,
            ],
            'ssl' => [
                'verify_peer' => true,
                'verify_peer_name' => true,
            ]
        ];

        if ($content !== null) {
            $options['http']['content'] = $content;
        }

        $context = stream_context_create($options);
        $responseBody = @file_get_contents($url, false, $context);

        if ($responseBody === false) {
            return [0, null, 'Failed to connect to Supabase'];
        }

        $statusCode = 200;
        if (isset($http_response_header)) {
            foreach ($http_response_header as $header) {
                if (preg_match('/^HTTP\/\d\.\d\s+(\d+)/', $header, $matches)) {
                    $statusCode = (int) $matches[1];
                    break;
                }
            }
        }
    }

    $decoded = json_decode($responseBody, true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        return [$statusCode, $responseBody, null];
    }

    return [$statusCode, $decoded, null];
}

/**
 * Compresses a base64 image string to a smaller thumbnail
 */
function compress_base64_image(string $base64Str, int $maxWidth = 100, int $quality = 50): string
{
    try {
        if (strpos($base64Str, 'data:image') === 0) {
            $parts = explode(',', $base64Str);
            $data = base64_decode($parts[1]);
        } else {
            $data = base64_decode($base64Str);
        }

        $src = imagecreatefromstring($data);
        if (!$src)
            return $base64Str;

        $width = imagesx($src);
        $height = imagesy($src);

        if ($width <= $maxWidth) {
            imagedestroy($src);
            return $base64Str;
        }

        $newWidth = $maxWidth;
        $newHeight = floor($height * ($maxWidth / $width));

        $tmp = imagecreatetruecolor($newWidth, $newHeight);
        imagealphablending($tmp, false);
        imagesavealpha($tmp, true);
        imagecopyresampled($tmp, $src, 0, 0, 0, 0, $newWidth, $newHeight, $width, $height);

        ob_start();
        imagejpeg($tmp, null, $quality);
        $compressedData = ob_get_clean();

        imagedestroy($src);
        imagedestroy($tmp);

        return 'data:image/jpeg;base64,' . base64_encode($compressedData);
    } catch (Exception $e) {
        return $base64Str;
    }
}

function supabase_insert(string $table, array $row): array
{
    return supabase_request('POST', "rest/v1/{$table}", $row, [
        'Prefer: return=representation',
    ]);
}

function supabase_select(string $table, array $filters = [], string $select = '*', string $orderBy = ''): array
{
    $path = "rest/v1/{$table}?select={$select}";
    foreach ($filters as $key => $value) {
        $path .= "&{$key}=eq." . urlencode($value);
    }
    if ($orderBy !== '') {
        $path .= "&order={$orderBy}";
    }
    return supabase_request('GET', $path);
}

function supabase_select_single(string $table, array $filters = [], string $select = '*'): array
{
    $path = "rest/v1/{$table}?select={$select}";
    foreach ($filters as $key => $value) {
        $path .= "&{$key}=eq." . urlencode($value);
    }
    return supabase_request('GET', $path, null, [
        'Accept: application/vnd.pgrst.object+json',
    ]);
}
