<?php
// Helper functions for face retrieval and verification

require_once __DIR__ . '/connect.php';

function fetchUserFaceData(string $userId, string $engine = '') {
    // Fetch face_embedding (Camera Vision)
    $selectCols = "profile_picture,username,log_id,face_embedding";
    
    [$status, $data, $err] = supabase_request('GET', "rest/v1/accounts?log_id=eq." . urlencode($userId) . "&select=" . $selectCols);
    if ($err) return [null, 'Database connection error: ' . $err];
    if ($status !== 200 || !is_array($data) || count($data) === 0) return [null, 'User not found'];
    
    $account = $data[0];
    
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
            'face_embedding' => $faceEmbedding,
        ],
        null
    ];
}
