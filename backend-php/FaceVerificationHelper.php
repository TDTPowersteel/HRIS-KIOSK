<?php
// Helper functions for face retrieval and verification

require_once __DIR__ . '/connect.php';

function fetchUserFaceData(string $userId, string $engine = '') {
    $isIntern = false;
    if (strpos($userId, 'intern_') === 0) {
        $isIntern = true;
    } else if (defined('KIOSK_MODE') && KIOSK_MODE === 'intern') {
        $isIntern = true;
    }

    if ($isIntern) {
        $internId = (int)preg_replace('/^intern_/', '', $userId);
        $db = getImsConnection();
        $stmt = $db->prepare("SELECT id, first_name, last_name, email, profile_photo, face_embedding, face_embedding_large FROM interns WHERE id = ? AND status = 'Active'");
        if ($stmt === false) {
            return [null, 'Database connection/prepare error: ' . $db->error];
        }
        $stmt->bind_param('i', $internId);
        if (!$stmt->execute()) {
            $stmt->close();
            return [null, 'Database execution error: ' . $stmt->error];
        }
        $row = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        if (!$row) {
            return [null, 'Intern not found'];
        }

        $scheme = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on') ? 'https' : 'http';
        $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
        $profilePhotoUrl = null;
        if (!empty($row['profile_photo'])) {
            $imsUrl = getenv('IMS_URL') ?: null;
            if (!empty($imsUrl)) {
                $profilePhotoUrl = rtrim($imsUrl, '/') . "/uploads/photos/" . $row['profile_photo'];
            } else {
                if (preg_match('/:80\d\d$/', $host)) {
                    $imsHost = preg_replace('/:80\d\d$/', ':8002', $host);
                    $profilePhotoUrl = "{$scheme}://{$imsHost}/uploads/photos/" . $row['profile_photo'];
                } else {
                    $profilePhotoUrl = "{$scheme}://{$host}/ims/uploads/photos/" . $row['profile_photo'];
                }
            }
        }

        $faceEmbedding = null;
        $rawEmbedding = $row['face_embedding'] ?? null;
        if (is_array($rawEmbedding) || is_object($rawEmbedding)) {
            $faceEmbedding = json_encode($rawEmbedding);
        } else if ($rawEmbedding !== null) {
            $faceEmbedding = trim((string)$rawEmbedding);
        }

        $faceEmbeddingLarge = null;
        $rawEmbeddingLarge = $row['face_embedding_large'] ?? null;
        if (is_array($rawEmbeddingLarge) || is_object($rawEmbeddingLarge)) {
            $faceEmbeddingLarge = json_encode($rawEmbeddingLarge);
        } else if ($rawEmbeddingLarge !== null) {
            $faceEmbeddingLarge = trim((string)$rawEmbeddingLarge);
        }

        return [
            [
                'log_id' => 'intern_' . $row['id'],
                'username' => 'intern_' . $row['id'],
                'profile_picture' => $profilePhotoUrl,
                'face_embedding' => $faceEmbedding,
                'face_embedding_large' => $faceEmbeddingLarge,
            ],
            null
        ];
    }

    // Fetch face_embedding (Camera Vision)
    $selectCols = "profile_picture,username,log_id,face_embedding,face_embedding_large";
    
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

    $faceEmbeddingLarge = null;
    $rawEmbeddingLarge = $account['face_embedding_large'] ?? null;
    if (is_array($rawEmbeddingLarge) || is_object($rawEmbeddingLarge)) {
        $faceEmbeddingLarge = json_encode($rawEmbeddingLarge);
    } else if ($rawEmbeddingLarge !== null) {
        $faceEmbeddingLarge = trim((string)$rawEmbeddingLarge);
    }

    return [
        [
            'log_id' => $account['log_id'],
            'username' => $account['username'],
            'profile_picture' => $account['profile_picture'] ?? null,
            'face_embedding' => $faceEmbedding,
            'face_embedding_large' => $faceEmbeddingLarge,
        ],
        null
    ];
}

