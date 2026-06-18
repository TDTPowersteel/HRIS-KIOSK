package com.ams.attendanceapp

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableArray
import java.io.File
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

class NativeFacePreprocessorModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String {
        return "NativeFacePreprocessor"
    }

    @ReactMethod
    fun preprocessFace(photoPath: String, faceBox: ReadableMap?, jsW: Double, jsH: Double, promise: Promise) {
        try {
            val path = if (photoPath.startsWith("file://")) {
                photoPath.substring(7)
            } else {
                photoPath
            }

            val file = File(path)
            if (!file.exists()) {
                promise.reject("FILE_NOT_FOUND", "File not found at: $path")
                return
            }

            val options = BitmapFactory.Options().apply {
                inPreferredConfig = Bitmap.Config.ARGB_8888
            }
            var bitmap = BitmapFactory.decodeFile(path, options)
            if (bitmap == null) {
                promise.reject("DECODE_FAILED", "Failed to decode bitmap from $path")
                return
            }

            val origW = bitmap.width
            val origH = bitmap.height
            var orientation = android.media.ExifInterface.ORIENTATION_NORMAL

            // Read EXIF orientation and rotate/mirror bitmap if necessary to align with resolved photo dimensions
            try {
                val exifInterface = android.media.ExifInterface(path)
                orientation = exifInterface.getAttributeInt(
                    android.media.ExifInterface.TAG_ORIENTATION,
                    android.media.ExifInterface.ORIENTATION_NORMAL
                )
                val matrix = android.graphics.Matrix()
                var needsTransform = false

                when (orientation) {
                    android.media.ExifInterface.ORIENTATION_ROTATE_90 -> {
                        matrix.postRotate(90f)
                        needsTransform = true
                    }
                    android.media.ExifInterface.ORIENTATION_ROTATE_180 -> {
                        matrix.postRotate(180f)
                        needsTransform = true
                    }
                    android.media.ExifInterface.ORIENTATION_ROTATE_270 -> {
                        matrix.postRotate(270f)
                        needsTransform = true
                    }
                    android.media.ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> {
                        matrix.postScale(-1f, 1f)
                        needsTransform = true
                    }
                    android.media.ExifInterface.ORIENTATION_TRANSPOSE -> {
                        matrix.postRotate(90f)
                        needsTransform = true
                    }
                    android.media.ExifInterface.ORIENTATION_TRANSVERSE -> {
                        matrix.postRotate(270f)
                        needsTransform = true
                    }
                }

                if (needsTransform) {
                    val transformed = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
                    if (transformed != bitmap) {
                        bitmap.recycle()
                        bitmap = transformed
                    }
                }
            } catch (e: Exception) {
                Log.w("NativeFacePreprocessor", "EXIF read error: ${e.message}")
            }

            // Force align bitmap orientation with JS dimensions to resolve aspect ratio swap (e.g. portrait sensor file vs landscape JS dimensions)
            if (jsW > 0 && jsH > 0) {
                val isJsLandscape = jsW > jsH
                val isBitmapLandscape = bitmap.width > bitmap.height
                if (isJsLandscape != isBitmapLandscape) {
                    val matrix = android.graphics.Matrix()
                    matrix.postRotate(90f)
                    val transformed = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
                    if (transformed != bitmap) {
                        bitmap.recycle()
                        bitmap = transformed
                    }
                    Log.d("NativeFacePreprocessor", "Aligned aspect ratio. Swapped dimensions. New size: ${bitmap.width}x${bitmap.height}")
                }
            }

            val srcW = bitmap.width
            val srcH = bitmap.height
            Log.d("NativeFacePreprocessor", "Path: $path | Original: ${origW}x${origH} | Orientation: $orientation | Preprocessed Src: ${srcW}x${srcH}")

            var cropX = 0
            var cropY = 0
            var cropW = srcW
            var cropH = srcH

            if (faceBox != null) {
                val xRatio = if (faceBox.hasKey("x") && !faceBox.isNull("x")) faceBox.getDouble("x") else 0.0
                val yRatio = if (faceBox.hasKey("y") && !faceBox.isNull("y")) faceBox.getDouble("y") else 0.0
                val wRatio = if (faceBox.hasKey("width") && !faceBox.isNull("width")) faceBox.getDouble("width") else 1.0
                val hRatio = if (faceBox.hasKey("height") && !faceBox.isNull("height")) faceBox.getDouble("height") else 1.0

                cropX = max(0, min(floor(xRatio * srcW).toInt(), srcW - 1))
                cropY = max(0, min(floor(yRatio * srcH).toInt(), srcH - 1))
                cropW = max(1, min(floor(wRatio * srcW).toInt(), srcW - cropX))
                cropH = max(1, min(floor(hRatio * srcH).toInt(), srcH - cropY))

                Log.d("NativeFacePreprocessor", "FaceBox Map: x=$xRatio, y=$yRatio, w=$wRatio, h=$hRatio")
                Log.d("NativeFacePreprocessor", "Pixel Crop bounds: cropX=$cropX, cropY=$cropY, cropW=$cropW, cropH=$cropH")
            }

            // Crop face region
            val cropped = Bitmap.createBitmap(bitmap, cropX, cropY, cropW, cropH)
            if (cropped != bitmap) {
                bitmap.recycle()
            }

            // High-quality Bilinear scaling to 112x112 (critical for ONNX face accuracy)
            var resized = Bitmap.createScaledBitmap(cropped, 112, 112, true)
            if (resized != cropped) {
                cropped.recycle()
            }

            // Restore un-mirrored face alignment if frontend snapshot image is mirrored
            val isMirrored = if (faceBox != null && faceBox.hasKey("isMirrored") && !faceBox.isNull("isMirrored")) {
                faceBox.getBoolean("isMirrored")
            } else {
                false
            }
            if (isMirrored) {
                val matrix = android.graphics.Matrix()
                matrix.postScale(-1f, 1f)
                val transformed = Bitmap.createBitmap(resized, 0, 0, resized.width, resized.height, matrix, true)
                if (transformed != resized) {
                    resized.recycle()
                    resized = transformed
                }
            }

            val size = 112
            val pixelCount = size * size
            val pixels = IntArray(pixelCount)
            resized.getPixels(pixels, 0, size, 0, 0, size, size)
            resized.recycle()

            // 1. Calculate perceived brightness
            var totalLuminance = 0.0
            val gray = DoubleArray(pixelCount)
            for (i in 0 until pixelCount) {
                val pixel = pixels[i]
                val r = (pixel shr 16) and 0xff
                val g = (pixel shr 8) and 0xff
                val b = pixel and 0xff
                val lum = 0.299 * r + 0.587 * g + 0.114 * b
                gray[i] = lum
                totalLuminance += lum
            }
            val avgBrightness = totalLuminance / pixelCount
            if (avgBrightness < 50.0) {
                promise.reject("PREPROCESS_TOO_DARK", "Too dark. Move to a well-lit area.")
                return
            }

            // 2. Calculate Laplacian variance for motion blur detection
            val laplacian = DoubleArray(pixelCount)
            var mean = 0.0
            var count = 0
            for (y in 1 until size - 1) {
                for (x in 1 until size - 1) {
                    val idx = y * size + x
                    val valLap = gray[idx + 1] + gray[idx - 1] + gray[idx + size] + gray[idx - size] - 4.0 * gray[idx]
                    laplacian[idx] = valLap
                    mean += valLap
                    count++
                }
            }
            mean /= count

            var variance = 0.0
            for (y in 1 until size - 1) {
                for (x in 1 until size - 1) {
                    val idx = y * size + x
                    val diff = laplacian[idx] - mean
                    variance += diff * diff
                }
            }
            variance /= count

            if (variance < 50.0) {
                promise.reject("PREPROCESS_TOO_BLURRY", "Image was blurry. Please hold still.")
                return
            }

            val tensor = FloatArray(3 * pixelCount)
            for (i in 0 until pixelCount) {
                val pixel = pixels[i]
                val r = (pixel shr 16) and 0xff
                val g = (pixel shr 8) and 0xff
                val b = pixel and 0xff
                tensor[i] = (r - 127.5f) / 128.0f
                tensor[pixelCount + i] = (g - 127.5f) / 128.0f
                tensor[2 * pixelCount + i] = (b - 127.5f) / 128.0f
            }

            val byteBuffer = java.nio.ByteBuffer.allocate(tensor.size * 4).apply {
                order(java.nio.ByteOrder.LITTLE_ENDIAN)
                asFloatBuffer().put(tensor)
            }
            val base64Str = android.util.Base64.encodeToString(byteBuffer.array(), android.util.Base64.NO_WRAP)
            promise.resolve(base64Str)
        } catch (e: Exception) {
            promise.reject("PREPROCESS_FAILED", e.message, e)
        }
    }
}
