<?php
/**
 * Luxand Face Recognition API Helper Functions
 * 
 * API Documentation: https://docs.luxand.cloud/
 * Dashboard: https://dashboard.luxand.cloud/
 * 
 * Usage:
 * 1. Get your API token from https://dashboard.luxand.cloud/token
 * 2. Set LUXAND_API_TOKEN in this file
 * 3. The system will automatically use Luxand for face recognition
 */

// Luxand API Configuration
define('LUXAND_API_TOKEN', getenv('LUXAND_API_TOKEN') ?: '');
const LUXAND_API_BASE_URL = 'https://api.luxand.cloud/v2';

// Global variable to store last Luxand API error
$GLOBALS['luxand_last_error'] = null;

/**
 * Recognize a face in an image using Luxand API
 * 
 * @param string $imageBase64 Base64 encoded image
 * @return array|null Array with person_id and confidence, or null on error
 */
function luxand_recognize_face(string $imageBase64): ?array
{
    if (empty(LUXAND_API_TOKEN) || LUXAND_API_TOKEN === 'YOUR_LUXAND_API_TOKEN_HERE') {
        $GLOBALS['luxand_last_error'] = 'Luxand API token not configured';
        error_log("Luxand API token not configured");
        return null;
    }
    
    // Luxand API endpoint for searching faces
    // Try /search first (most common endpoint)
    $url = LUXAND_API_BASE_URL . '/search';
    
    $imageData = base64_decode($imageBase64, true);
    if ($imageData === false) {
        $GLOBALS['luxand_last_error'] = 'Invalid base64 image data';
        error_log("Invalid base64 image data for Luxand API");
        return null;
    }
    
    // Validate image size (Luxand typically accepts up to 10MB)
    if (strlen($imageData) < 1024) {
        $GLOBALS['luxand_last_error'] = 'Image too small: ' . strlen($imageData) . ' bytes';
        error_log("Image too small for Luxand API: " . strlen($imageData) . " bytes");
        return null;
    }
    
    if (strlen($imageData) > 10 * 1024 * 1024) {
        $GLOBALS['luxand_last_error'] = 'Image too large: ' . strlen($imageData) . ' bytes';
        error_log("Image too large for Luxand API: " . strlen($imageData) . " bytes");
        return null;
    }
    
    // Create multipart form data
    $boundary = uniqid();
    $delimiter = '-------------' . $boundary;
    
    $postData = '';
    $postData .= '--' . $delimiter . "\r\n";
    $postData .= 'Content-Disposition: form-data; name="photo"; filename="face.jpg"' . "\r\n";
    $postData .= 'Content-Type: image/jpeg' . "\r\n\r\n";
    $postData .= $imageData . "\r\n";
    $postData .= '--' . $delimiter . '--';
    
    $headers = [
        'Authorization: Token ' . LUXAND_API_TOKEN,
        'Content-Type: multipart/form-data; boundary=' . $delimiter,
    ];
    
    // Try with Token authorization first
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $postData,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_TIMEOUT => 8, // Reduced from 15 to 8 for faster timeout (fail fast)
        CURLOPT_CONNECTTIMEOUT => 3, // Reduced from 5 to 3 for faster connection
    ]);
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    
    if ($error) {
        $GLOBALS['luxand_last_error'] = 'CURL Error: ' . $error;
        error_log("Luxand API curl error: " . $error);
        return null;
    }
    
    // If 401 (Unauthorized), try Bearer token format
    if ($httpCode === 401) {
        error_log("Luxand API: 401 Unauthorized with Token format, trying Bearer format...");
        $headersAlt = [
            'Authorization: Bearer ' . LUXAND_API_TOKEN,
            'Content-Type: multipart/form-data; boundary=' . $delimiter,
            'Accept: application/json',
        ];
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $postData,
            CURLOPT_HTTPHEADER => $headersAlt,
            CURLOPT_TIMEOUT => 8, // Reduced for faster timeout
            CURLOPT_CONNECTTIMEOUT => 3, // Reduced for faster connection
        ]);
        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        
        if ($error) {
            $GLOBALS['luxand_last_error'] = 'CURL Error: ' . $error;
            error_log("Luxand API curl error (Bearer): " . $error);
            return null;
        }
    }
    
    if ($httpCode !== 200) {
        // Try to parse error message
        $errorDetails = json_decode($response, true);
        $errorMessage = $errorDetails['message'] ?? $errorDetails['error'] ?? $errorDetails['detail'] ?? $response;
        
        // If 404, the endpoint might be wrong - log full response for debugging
        if ($httpCode === 404) {
            error_log("Luxand API: 404 error - endpoint might be wrong. URL: $url");
            error_log("Luxand API: Full response: " . substr($response, 0, 500));
            // Try alternative endpoint: /search instead of /photo/search
            $altUrl = LUXAND_API_BASE_URL . '/search';
            error_log("Luxand API: Trying alternative endpoint: $altUrl");
            
            $ch2 = curl_init($altUrl);
            curl_setopt_array($ch2, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_POST => true,
                CURLOPT_POSTFIELDS => $postData,
                CURLOPT_HTTPHEADER => $headers,
                CURLOPT_TIMEOUT => 15,
                CURLOPT_CONNECTTIMEOUT => 5,
            ]);
            $response2 = curl_exec($ch2);
            $httpCode2 = curl_getinfo($ch2, CURLINFO_HTTP_CODE);
            
            if ($httpCode2 === 200) {
                error_log("Luxand API: Alternative endpoint /search worked!");
                $result = json_decode($response2, true);
                if (is_array($result) && !empty($result)) {
                    $bestMatch = $result[0] ?? $result;
                    $similarity = $bestMatch['similarity'] ?? $bestMatch['confidence'] ?? $bestMatch['score'] ?? 0.0;
                    if (is_numeric($similarity) && $similarity > 1.0) {
                        $similarity = (float)$similarity / 100.0;
                    }
                    return [
                        'person_id' => $bestMatch['person_id'] ?? $bestMatch['id'] ?? null,
                        'similarity' => (float)$similarity,
                        'name' => $bestMatch['name'] ?? null,
                    ];
                }
            } else {
                error_log("Luxand API: Alternative endpoint also failed with HTTP $httpCode2");
            }
        }
        
        $GLOBALS['luxand_last_error'] = "HTTP $httpCode: " . substr($errorMessage, 0, 200);
        error_log("Luxand API HTTP error: $httpCode - " . substr($errorMessage, 0, 200));
        return null;
    }
    
    $result = json_decode($response, true);
    if (!is_array($result)) {
        $GLOBALS['luxand_last_error'] = 'Invalid response format: ' . substr($response, 0, 200);
        error_log("Luxand API invalid response: " . substr($response, 0, 200));
        return null;
    }
    
    // Luxand returns array of matches with person_id and similarity
    if (empty($result) || !isset($result[0])) {
        $GLOBALS['luxand_last_error'] = 'No faces found in image';
        error_log("Luxand API: No faces found in image");
        return null;
    }
    
    // Return best match
    $bestMatch = $result[0];
    $similarity = $bestMatch['similarity'] ?? $bestMatch['confidence'] ?? $bestMatch['score'] ?? 0.0;
    
    // Convert percentage to decimal if needed (e.g., 85.5 -> 0.855)
    if (is_numeric($similarity) && $similarity > 1.0) {
        $similarity = (float)$similarity / 100.0;
    }
    
    return [
        'person_id' => $bestMatch['person_id'] ?? $bestMatch['id'] ?? null,
        'similarity' => (float)$similarity,
        'name' => $bestMatch['name'] ?? null,
    ];
}

/**
 * Add a person/face to Luxand database
 * 
 * @param string $imageBase64 Base64 encoded image
 * @param string $personName Name/identifier for the person
 * @return string|null Person ID or null on error
 */
function luxand_add_person(string $imageBase64, string $personName): ?string
{
    if (empty(LUXAND_API_TOKEN) || LUXAND_API_TOKEN === 'YOUR_LUXAND_API_TOKEN_HERE') {
        $GLOBALS['luxand_last_error'] = 'Luxand API token not configured';
        error_log("Luxand API token not configured");
        return null;
    }
    
    // Luxand API endpoint for adding a person
    $url = LUXAND_API_BASE_URL . '/person';
    
    $imageData = base64_decode($imageBase64, true);
    if ($imageData === false) {
        $GLOBALS['luxand_last_error'] = 'Invalid base64 image data';
        return null;
    }
    
    // Create multipart form data
    $boundary = uniqid();
    $delimiter = '-------------' . $boundary;
    
    $postData = '';
    $postData .= '--' . $delimiter . "\r\n";
    $postData .= 'Content-Disposition: form-data; name="name"' . "\r\n\r\n";
    $postData .= $personName . "\r\n";
    $postData .= '--' . $delimiter . "\r\n";
    $postData .= 'Content-Disposition: form-data; name="photo"; filename="face.jpg"' . "\r\n";
    $postData .= 'Content-Type: image/jpeg' . "\r\n\r\n";
    $postData .= $imageData . "\r\n";
    $postData .= '--' . $delimiter . '--';
    
    $headers = [
        'Authorization: Token ' . LUXAND_API_TOKEN,
        'Content-Type: multipart/form-data; boundary=' . $delimiter,
    ];
    
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $postData,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_TIMEOUT => 8, // Reduced from 15 to 8 for faster timeout (fail fast)
        CURLOPT_CONNECTTIMEOUT => 3, // Reduced from 5 to 3 for faster connection
    ]);
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    
    if ($error) {
        $GLOBALS['luxand_last_error'] = 'CURL Error: ' . $error;
        error_log("Luxand API add person curl error: " . $error);
        return null;
    }
    
    if ($httpCode !== 200 && $httpCode !== 201) {
        $errorDetails = json_decode($response, true);
        $errorMessage = $errorDetails['message'] ?? $errorDetails['error'] ?? $response;
        $GLOBALS['luxand_last_error'] = "HTTP $httpCode: $errorMessage";
        error_log("Luxand API add person HTTP error: $httpCode - $errorMessage");
        return null;
    }
    
    $result = json_decode($response, true);
    if (!is_array($result) || !isset($result['id'])) {
        $GLOBALS['luxand_last_error'] = 'Invalid response format';
        return null;
    }
    
    return $result['id'];
}

/**
 * Directly compare two faces using Luxand API
 * This compares two images directly without requiring registration in Luxand database
 * 
 * @param string $image1Base64 Base64 encoded image 1 (uploaded photo)
 * @param string $image2Base64 Base64 encoded image 2 (stored face from database)
 * @return float Similarity score between 0.0 and 1.0, or -1 on error
 */
function luxand_compare_faces_direct(string $image1Base64, string $image2Base64): float
{
    if (empty(LUXAND_API_TOKEN) || LUXAND_API_TOKEN === 'YOUR_LUXAND_API_TOKEN_HERE') {
        $GLOBALS['luxand_last_error'] = 'Luxand API token not configured';
        return -1.0;
    }
    
    // Decode images
    $image1Data = base64_decode($image1Base64, true);
    $image2Data = base64_decode($image2Base64, true);
    
    if ($image1Data === false || $image2Data === false) {
        $GLOBALS['luxand_last_error'] = 'Invalid base64 image data';
        return -1.0;
    }
    
    // Create temporary files for the images
    $tmpFile1 = tempnam(sys_get_temp_dir(), 'luxand_face1_');
    $tmpFile2 = tempnam(sys_get_temp_dir(), 'luxand_face2_');
    file_put_contents($tmpFile1, $image1Data);
    file_put_contents($tmpFile2, $image2Data);
    
    // Try Luxand photo/verify/v2 endpoint for direct comparison
    $url = 'https://api.luxand.cloud/photo/verify/v2';
    
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => [
            'photo1' => new CURLFile($tmpFile1, 'image/jpeg', 'photo1.jpg'),
            'photo2' => new CURLFile($tmpFile2, 'image/jpeg', 'photo2.jpg')
        ],
        CURLOPT_HTTPHEADER => [
            'token: ' . LUXAND_API_TOKEN
        ],
        CURLOPT_TIMEOUT => 15,
        CURLOPT_CONNECTTIMEOUT => 5
    ]);
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    
    // Clean up temp files
    unlink($tmpFile1);
    unlink($tmpFile2);
    
    if ($error) {
        $GLOBALS['luxand_last_error'] = 'CURL Error: ' . $error;
        error_log("Luxand API curl error: " . $error);
        return -1.0;
    }
    
    if ($httpCode !== 200) {
        $errorData = @json_decode($response, true);
        $errorMsg = is_array($errorData) ? ($errorData['message'] ?? $errorData['error'] ?? 'HTTP ' . $httpCode) : 'HTTP ' . $httpCode;
        $GLOBALS['luxand_last_error'] = $errorMsg;
        error_log("Luxand API HTTP error ($httpCode): " . substr($response, 0, 200));
        return -1.0;
    }
    
    $data = @json_decode($response, true);
    
    if (!is_array($data)) {
        $GLOBALS['luxand_last_error'] = 'Invalid JSON response';
        error_log("Luxand API invalid JSON: " . substr($response, 0, 200));
        return -1.0;
    }
    
    // Check for similarity in response
    $similarity = null;
    if (isset($data['similarity'])) {
        $similarity = (float)$data['similarity'];
    } else if (isset($data['score'])) {
        $similarity = (float)$data['score'];
    } else if (isset($data['confidence'])) {
        $similarity = (float)$data['confidence'];
    } else if (isset($data['match'])) {
        $similarity = (float)$data['match'];
    }
    
    if ($similarity === null) {
        $GLOBALS['luxand_last_error'] = 'No similarity in response. Keys: ' . implode(', ', array_keys($data));
        error_log("Luxand API no similarity: " . json_encode($data));
        return -1.0;
    }
    
    // Convert percentage to decimal if needed
    if ($similarity > 1.0) {
        $similarity = $similarity / 100.0;
    }
    
    return max(0.0, min(1.0, $similarity));
}

/**
 * Verify if two faces match using Luxand API
 * This compares an uploaded face with a stored face using Luxand's comparison
 * 
 * @param string $image1Base64 Base64 encoded image 1 (uploaded photo)
 * @param string $image2Base64 Base64 encoded image 2 (stored face from database)
 * @return float Similarity score between 0.0 and 1.0, or -1 on error
 */
function luxand_verify_faces(string $image1Base64, string $image2Base64): float
{
    // Use direct comparison instead of database search
    return luxand_compare_faces_direct($image1Base64, $image2Base64);
}

/**
 * Get the last Luxand API error message
 * 
 * @return string|null Error message or null if no error
 */
function luxand_get_last_error(): ?string
{
    return $GLOBALS['luxand_last_error'] ?? null;
}

/**
 * Check if Luxand Face API is configured
 * 
 * @return bool True if configured, false otherwise
 */
function luxand_face_api_configured(): bool
{
    $tokenConfigured = !empty(LUXAND_API_TOKEN) && 
                       LUXAND_API_TOKEN !== 'YOUR_LUXAND_API_TOKEN_HERE';
    
    return $tokenConfigured;
}
