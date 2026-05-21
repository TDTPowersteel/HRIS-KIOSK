import jpeg from 'jpeg-js';

// React Native global atob is available; fall back to manual decode
const decodeBase64 = (base64: string): Uint8Array => {
  const binaryString = global.atob(base64);
  return Uint8Array.from(binaryString, (c) => c.charCodeAt(0));
};

export function base64ToPixels(base64: string): Uint8Array {
  const binary = decodeBase64(base64);
  const decoded = jpeg.decode(binary, { useTArray: true });
  return decoded.data; // RGBA uint8, length = 112 * 112 * 4
}

/**
 * Convert RGBA pixels to CHW Float32 tensor normalized to [-1, 1].
 * buffalo_sc: RGB order, CHW layout, (pixel - 127.5) / 128.0
 */
export function preprocessFace(rgbaPixels: Uint8Array): Float32Array {
  const size = 112 * 112;
  const tensor = new Float32Array(3 * size);

  for (let i = 0; i < size; i++) {
    const r = rgbaPixels[i * 4];
    const g = rgbaPixels[i * 4 + 1];
    const b = rgbaPixels[i * 4 + 2];
    tensor[i]            = (r - 127.5) / 128.0; // R plane
    tensor[size + i]     = (g - 127.5) / 128.0; // G plane
    tensor[2 * size + i] = (b - 127.5) / 128.0; // B plane
  }

  return tensor;
}

export function prepareEmbeddingInput(base64Image: string): Float32Array {
  const pixels = base64ToPixels(base64Image);
  return preprocessFace(pixels);
}

/**
 * Convert raw RGBA pixel buffer to CHW Float32 tensor.
 * Used when we already have decoded RGBA pixels (e.g. from jpeg-js).
 */
export function rgbaBufferToCHWTensor(
  rgba: Uint8Array,
  srcW: number,
  srcH: number,
  faceBox?: { x: number; y: number; width: number; height: number },
): Float32Array {
  const SIZE = 112;
  const tensor = new Float32Array(3 * SIZE * SIZE);

  const cropX = faceBox ? Math.max(0, Math.floor(faceBox.x * srcW)) : 0;
  const cropY = faceBox ? Math.max(0, Math.floor(faceBox.y * srcH)) : 0;
  const cropW = faceBox ? Math.max(1, Math.min(Math.floor(faceBox.width * srcW), srcW - cropX)) : srcW;
  const cropH = faceBox ? Math.max(1, Math.min(Math.floor(faceBox.height * srcH), srcH - cropY)) : srcH;

  const xr = cropW / SIZE;
  const yr = cropH / SIZE;
  const pixelCount = SIZE * SIZE;

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const sx = Math.min(cropX + Math.floor(x * xr), srcW - 1);
      const sy = Math.min(cropY + Math.floor(y * yr), srcH - 1);
      const si = (sy * srcW + sx) * 4; // RGBA = 4 bytes per pixel
      const pi = y * SIZE + x;

      tensor[pi]                = (rgba[si]     - 127.5) / 128.0; // R plane
      tensor[pixelCount + pi]   = (rgba[si + 1] - 127.5) / 128.0; // G plane
      tensor[2 * pixelCount + pi] = (rgba[si + 2] - 127.5) / 128.0; // B plane
    }
  }

  return tensor;
}
