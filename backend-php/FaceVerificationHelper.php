<?php
// Helper functions for face retrieval and verification

require_once __DIR__ . '/connect.php';

if (file_exists(__DIR__ . '/facepp_api.php')) {
    require_once __DIR__ . '/facepp_api.php';
}

function fetchUserFaceData(string $userId, string $engine = '') {
    // Fetch both face (Face++) and face_embedding (Camera Vision) for robustness
    $selectCols = "profile_picture,username,log_id,face,face_embedding";
    
    [$status, $data, $err] = supabase_request('GET', "rest/v1/accounts?log_id=eq." . urlencode($userId) . "&select=" . $selectCols);
    if ($err) return [null, 'Database connection error: ' . $err];
    if ($status !== 200 || !is_array($data) || count($data) === 0) return [null, 'User not found'];
    
    $account = $data[0];
    $storedFace = $account['face'] ?? null;
    $storedFaceBase64 = null;
    
    if ($storedFace && is_string($storedFace)) {
        $hex = null;
        if (strpos($storedFace, '\\x') === 0 && strlen($storedFace) > 2) {
            $hex = substr($storedFace, 2);
        } elseif (strlen($storedFace) > 20 && ctype_xdigit($storedFace)) {
            $hex = $storedFace;
        }
        if ($hex !== null) {
            $decoded = @hex2bin($hex);
            $storedFaceBase64 = ($decoded !== false) ? $decoded : $storedFace;
        } else {
            $storedFaceBase64 = $storedFace;
        }
    }
    
    $faceEmbedding = null;
    $rawEmbedding = $account['face_embedding'] ?? null;
    if (is_array($rawEmbedding) || is_object($rawEmbedding)) {
        $faceEmbedding = json_encode($rawEmbedding);
    } else if ($rawEmbedding !== null) {
        $faceEmbedding = trim((string)$rawEmbedding);
    }

    return [
        [
            'log_id' => $account['log_id'],
            'username' => $account['username'],
            'profile_picture' => $account['profile_picture'] ?? null,
            'face' => $storedFaceBase64,
            'face_embedding' => $faceEmbedding,
        ],
        null
    ];
}

function verifyLiveness(string $photoBase64, string $photoLivenessBase64) {
    if (!function_exists('facepp_api_configured') || !facepp_api_configured() || !function_exists('facepp_compare_faces')) {
        return [null, 'Face++ not configured'];
    }
    
    $livenessResult = facepp_compare_faces($photoBase64, $photoLivenessBase64);
    if ($livenessResult === null) {
        $err = function_exists('facepp_get_last_error') ? facepp_get_last_error() : 'Liveness comparison failed';
        return [null, $err];
    }
    
    $lScore = $livenessResult['confidence'];
    if ($lScore >= 0.992) {
        return [
            [
                'passed' => false,
                'score' => $lScore,
                'message' => 'Security Alert: Static photo detected.',
            ],
            null
        ];
    }
    
    if ($lScore < 0.80) {
        return [
            [
                'passed' => false,
                'score' => $lScore,
                'message' => 'Liveness check failed. Face moved too much or changed.',
            ],
            null
        ];
    }
    
    return [
        [
            'passed' => true,
            'score' => $lScore,
            'message' => 'Liveness passed',
        ],
        null
    ];
}

function verifyFacePhoto(string $photoBase64, string $storedFaceBase64) {
    if (!function_exists('facepp_api_configured') || !facepp_api_configured() || !function_exists('facepp_compare_faces')) {
        return [null, 'Face++ not configured'];
    }
    
    $result = facepp_compare_faces($photoBase64, $storedFaceBase64);
    if ($result === null) {
        $err = function_exists('facepp_get_last_error') ? facepp_get_last_error() : 'Comparison failed';
        return [null, $err];
    }
    
    return [$result, null];
}
