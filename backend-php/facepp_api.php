<?php
/**
 * Face++ (Megvii) Face Recognition API Integration
 * 
 * API Documentation: https://console.faceplusplus.com/documents/5679270
 * Dashboard: https://console.faceplusplus.com/
 * 
 * Free Tier: 1,000 calls/day (30,000/month)
 * Accuracy: 99.8%
 * 
 * Setup:
 * 1. Sign up at https://console.faceplusplus.com/register
 * 2. Get your API Key and API Secret from dashboard
 * 3. Set them below in FACEPP_API_KEY and FACEPP_API_SECRET
 */

// Face++ API Configuration
// IMPORTANT: never commit secrets. Configure via environment variables instead.
define('FACEPP_API_KEY', getenv('FACEPP_API_KEY') ?: '');
define('FACEPP_API_SECRET', getenv('FACEPP_API_SECRET') ?: '');
const FACEPP_API_BASE_URL = 'https://api-us.faceplusplus.com/facepp/v3';

// Global variable to store last Face++ API error
$GLOBALS['facepp_last_error'] = null;

/**c
 * Check if Face++ API is configured
 */
function facepp_api_configured(): bool
{
    return !empty(FACEPP_API_KEY) && 
           FACEPP_API_KEY !== 'YOUR_FACEPP_API_KEY_HERE' &&
           !empty(FACEPP_API_SECRET) && 
           FACEPP_API_SECRET !== 'YOUR_FACEPP_API_SECRET_HERE';
}

/**
 * Optimize image for Face++ API - resize and compress for faster upload
 * Target: Max 800px width/height, 80% quality, under 200KB
 * Falls back to original image if GD is not available
 */
function optimizeImageForFacePP(string $imageData): ?string
{
    // Check if GD extension is available
    if (!function_exists('imagecreatefromstring')) {
        error_log("GD extension not available - using original image for Face++");
        return $imageData; // Return original if GD not available
    }
    
    // Create image from string
    $img = @imagecreatefromstring($imageData);
    if ($img === false) {
        error_log("Failed to create image from data for Face++ optimization - using original");
        return $imageData; // Return original on error
    }
    
    $width = imagesx($img);
    $height = imagesy($img);
    
    // Skip optimization if already reasonable size and not too large in bytes
    if ($width <= 1200 && $height <= 1200 && strlen($imageData) < 800000) {
        error_log("Face++ skipping optimization: image is already $width x $height (" . strlen($imageData) . " bytes)");
        imagedestroy($img);
        return $imageData;
    }
    
    // Calculate new dimensions (max 1200px on longest side for better detail when far away)
    $maxDimension = 1200;
    if ($width > $maxDimension || $height > $maxDimension) {
        if ($width > $height) {
            $newWidth = $maxDimension;
            $newHeight = (int)(($height / $width) * $maxDimension);
        } else {
            $newHeight = $maxDimension;
            $newWidth = (int)(($width / $height) * $maxDimension);
        }
        
        // Create resized image
        $resized = imagecreatetruecolor($newWidth, $newHeight);
        imagecopyresampled($resized, $img, 0, 0, 0, 0, $newWidth, $newHeight, $width, $height);
        imagedestroy($img);
        $img = $resized;
        $width = $newWidth;
        $height = $newHeight;
    }
    
    // Convert to JPEG with 90% quality for better detail
    ob_start();
    imagejpeg($img, null, 90);
    $optimizedData = ob_get_clean();
    imagedestroy($img);
    
    error_log("Face++ image optimized: $width x $height (" . strlen($imageData) . " bytes -> " . strlen($optimizedData) . " bytes)");
    
    return $optimizedData;
}

/**
 * Compare two faces using Face++ API
 * 
 * @param string $image1Base64 Base64 encoded image 1
 * @param string $image2Base64 Base64 encoded image 2
 * @return array|null Array with confidence and similar boolean, or null on error
 */
function facepp_compare_faces(string $image1Base64, string $image2Base64): ?array
{
    if (!facepp_api_configured()) {
        $GLOBALS['facepp_last_error'] = 'Face++ API not configured - add your API Key and Secret';
        error_log("Face++ API not configured");
        return null;
    }
    
    // Face++ API endpoint for face comparison
    $url = FACEPP_API_BASE_URL . '/compare';
    
    // Decode base64 images (using robust helper)
    // Helper: robust base64 decode (strip non-base64 chars, try URL-safe variants)
    $safe_base64_decode = function($s) {
        if (!$s || !is_string($s)) return false;
        
        // If it already looks like a binary JPEG or PNG, don't decode
        if (strpos($s, "\xFF\xD8\xFF") === 0 || strpos($s, "\x89PNG") === 0) {
            return $s;
        }

        // Remove data URL prefix if present (including weird formats like jpeg;base64,)
        $s = preg_replace('/^[^,]*;base64,/', '', $s);
        
        // If it's pure binary after prefix removal, return it
        if (strpos($s, "\xFF\xD8\xFF") === 0 || strpos($s, "\x89PNG") === 0) {
            return $s;
        }

        // Strip characters not in base64 alphabet
        $clean = preg_replace('/[^A-Za-z0-9+\/=\-_]/', '', $s);
        if (empty($clean)) return false;

        $decoded = base64_decode($clean, true);
        if ($decoded === false) {
            // Try URL-safe replacements
            $repl = strtr($clean, '-_', '+/');
            $decoded = base64_decode($repl);
        }
        return $decoded;
    };

    // Decode base64 images (using robust helper)
    $imageData1 = $safe_base64_decode($image1Base64);
    $imageData2 = $safe_base64_decode($image2Base64);
    
    if ($imageData1 === false || $imageData2 === false) {
        $GLOBALS['facepp_last_error'] = 'Invalid base64 image data';
        error_log("Invalid base64 image data for Face++ API");
        return null;
    }
    
    // Optimize images for faster upload (resize if needed)
    $imageData1 = optimizeImageForFacePP($imageData1);
    $imageData2 = optimizeImageForFacePP($imageData2);
    
    if ($imageData1 === null || $imageData2 === null) {
        $GLOBALS['facepp_last_error'] = 'Failed to process images';
        error_log("Failed to process images for Face++ API");
        return null;
    }
    
    // Create temporary files for images
    $tempFile1 = tempnam(sys_get_temp_dir(), 'facepp_');
    $tempFile2 = tempnam(sys_get_temp_dir(), 'facepp_');
    file_put_contents($tempFile1, $imageData1);
    file_put_contents($tempFile2, $imageData2);
    
    // Prepare POST data
    $postData = [
        'api_key' => FACEPP_API_KEY,
        'api_secret' => FACEPP_API_SECRET,
        'image_file1' => new CURLFile($tempFile1, 'image/jpeg', 'image1.jpg'),
        'image_file2' => new CURLFile($tempFile2, 'image/jpeg', 'image2.jpg'),
    ];
    
    // Initialize cURL with optimized timeouts
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $postData,
        CURLOPT_TIMEOUT => 25,  // Increased to 25 seconds for API processing
        CURLOPT_CONNECTTIMEOUT => 8,  // Increased connection timeout
    ]);
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    
    // Cleanup temp files
    @unlink($tempFile1);
    @unlink($tempFile2);
    
    if ($error) {
        $GLOBALS['facepp_last_error'] = 'CURL Error: ' . $error;
        error_log("Face++ API curl error: " . $error);
        return null;
    }
    
    if ($httpCode !== 200) {
        // Try to parse error message
        $errorDetails = json_decode($response, true);
        $errorMessage = $errorDetails['error_message'] ?? $response;
        
        $GLOBALS['facepp_last_error'] = "HTTP $httpCode: " . substr($errorMessage, 0, 200);
        error_log("Face++ API HTTP error: $httpCode - " . substr($errorMessage, 0, 200));
        return null;
    }
    
    $result = json_decode($response, true);
    if (!is_array($result)) {
        $GLOBALS['facepp_last_error'] = 'Invalid response format: ' . substr($response, 0, 200);
        error_log("Face++ API invalid response: " . substr($response, 0, 200));
        return null;
    }
    
    // Check for API errors
    if (isset($result['error_message'])) {
        $GLOBALS['facepp_last_error'] = $result['error_message'];
        error_log("Face++ API error: " . $result['error_message']);
        return null;
    }
    
    // Face++ returns confidence score (0-100)
    $confidence = $result['confidence'] ?? 0;
    $thresholds = $result['thresholds'] ?? [];

    if ($confidence == 0) {
        error_log("Face++ Confidence is 0. Response detail: " . json_encode([
            'captured_faces_count' => count($result['faces1'] ?? []),
            'reference_faces_count' => count($result['faces2'] ?? []),
            'image_id1' => $result['image_id1'] ?? 'null',
            'image_id2' => $result['image_id2'] ?? 'null',
        ]));
    }
    
    // Use 1e-4 so same person (logged-in user) matches reliably; 1e-5 is too strict for attendance
    // 1e-3: looser | 1e-4: moderate | 1e-5: strict (more false rejections)
    $threshold = $thresholds['1e-4'] ?? ($thresholds['1e-5'] ?? 70.0);
    
    // Convert confidence to 0-1 scale for consistency
    $confidenceNormalized = $confidence / 100.0;
    $thresholdNormalized = $threshold / 100.0;
    
    $isSimilar = $confidence >= $threshold;
    
    error_log(sprintf(
        "Face++ API result - Confidence: %.2f, Threshold: %.2f, Match: %s",
        $confidence,
        $threshold,
        $isSimilar ? 'YES' : 'NO'
    ));
    
    return [
        'confidence' => $confidenceNormalized,
        'confidence_raw' => $confidence,
        'threshold' => $thresholdNormalized,
        'threshold_raw' => $threshold,
        'similar' => $isSimilar,
        'captured_faces_count' => count($result['faces1'] ?? []),
        'reference_faces_count' => count($result['faces2'] ?? []),
        'api' => 'facepp',
    ];
}

/**
 * Get the last Face++ API error
 */
function facepp_get_last_error(): ?string
{
    return $GLOBALS['facepp_last_error'] ?? null;
}
