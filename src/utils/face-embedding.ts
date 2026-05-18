import { loadTensorflowModel } from 'react-native-fast-tflite';
import type { TfliteModel } from 'react-native-fast-tflite/lib/typescript/specs/Tflite.nitro';

export const MODEL_CONFIG = {
  name: 'MobileFaceNet',
  inputSize: 112,
  channels: 3,
  matchThreshold: 0.65,
} as const;

let modelInstance: TfliteModel | null = null;
let modelLoading: Promise<TfliteModel> | null = null;
let modelAvailable = true;
let embeddingDim = 192;

export async function loadModel(): Promise<TfliteModel> {
  if (modelInstance) return modelInstance;
  if (modelLoading) return modelLoading;

  modelLoading = (async () => {
    try {
      const model = await loadTensorflowModel(
        require('../../assets/models/mobilefacenet.tflite'),
        ['android-gpu']
      );
      modelInstance = model;
      if (model.outputs && model.outputs.length > 0) {
        const outputShape = model.outputs[0].shape;
        embeddingDim = outputShape[outputShape.length - 1];
      }
      console.log(`[FaceEmbedding] Model loaded (output dim: ${embeddingDim})`);
      return model;
    } catch (error) {
      modelLoading = null;
      modelAvailable = false;
      console.error('[FaceEmbedding] Failed to load model:', error);
      throw error;
    }
  })();

  return modelLoading;
}

export function isModelAvailable(): boolean {
  return modelAvailable;
}

export function getEmbeddingDim(): number {
  return embeddingDim;
}

export async function preprocessImage(base64Image: string): Promise<Float32Array> {
  let rawBase64 = base64Image;
  if (rawBase64.startsWith('data:image')) {
    const commaIdx = rawBase64.indexOf(',');
    if (commaIdx !== -1) rawBase64 = rawBase64.substring(commaIdx + 1);
  }

  const binaryString = atob(rawBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const pixels = parseImageDimensions(bytes);
  if (!pixels) throw new Error('Failed to parse image dimensions');

  const size = MODEL_CONFIG.inputSize;
  const resized = bilinearResize(pixels.data, pixels.width, pixels.height, size, size);

  const tensorData = new Float32Array(1 * size * size * 3);
  for (let i = 0; i < size * size; i++) {
    tensorData[i * 3 + 0] = resized[i * 3 + 0] / 255.0;
    tensorData[i * 3 + 1] = resized[i * 3 + 1] / 255.0;
    tensorData[i * 3 + 2] = resized[i * 3 + 2] / 255.0;
  }

  return tensorData;
}

export async function generateEmbedding(base64Image: string): Promise<number[] | null> {
  try {
    const model = await loadModel();
    const inputData = await preprocessImage(base64Image);
    const inputBuffer = inputData.buffer as ArrayBuffer;
    const output = model.runSync([inputBuffer]);
    const rawEmbedding = Array.from(new Float32Array(output[0]));

    const norm = Math.sqrt(rawEmbedding.reduce((sum, val) => sum + val * val, 0));
    if (norm > 0) {
      for (let i = 0; i < rawEmbedding.length; i++) {
        rawEmbedding[i] /= norm;
      }
    }
    return rawEmbedding;
  } catch (error) {
    console.error('[FaceEmbedding] generateEmbedding failed:', error);
    return null;
  }
}

export function compareEmbeddings(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Embedding dimension mismatch: ${a.length} vs ${b.length}`);
  }
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return dotProduct / denominator;
}

export function isMatch(similarity: number, threshold?: number): boolean {
  return similarity >= (threshold ?? MODEL_CONFIG.matchThreshold);
}

// ─── Image Processing Helpers ────────────────────────────────────────────────

interface RgbImage {
  data: Uint8Array;
  width: number;
  height: number;
}

function parseImageDimensions(imageBytes: Uint8Array): RgbImage | null {
  let width = 0;
  let height = 0;

  for (let i = 0; i < imageBytes.length - 8; i++) {
    if (imageBytes[i] === 0xFF && (imageBytes[i + 1] === 0xC0 || imageBytes[i + 1] === 0xC2)) {
      height = (imageBytes[i + 5] << 8) | imageBytes[i + 6];
      width = (imageBytes[i + 7] << 8) | imageBytes[i + 8];
      break;
    }
  }

  if (width === 0 && imageBytes[0] === 0x89 && imageBytes[1] === 0x50) {
    width = (imageBytes[16] << 24) | (imageBytes[17] << 16) | (imageBytes[18] << 8) | imageBytes[19];
    height = (imageBytes[20] << 24) | (imageBytes[21] << 16) | (imageBytes[22] << 8) | imageBytes[23];
  }

  if (width === 0 || height === 0) {
    console.error('[FaceEmbedding] Could not parse image dimensions');
    return null;
  }

  const data = new Uint8Array(width * height * 3);
  data.fill(128);
  return { data, width, height };
}

function bilinearResize(
  srcData: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number
): Uint8Array {
  const dst = new Uint8Array(dstW * dstH * 3);
  const xRatio = srcW / dstW;
  const yRatio = srcH / dstH;

  for (let y = 0; y < dstH; y++) {
    for (let x = 0; x < dstW; x++) {
      const srcX = x * xRatio;
      const srcY = y * yRatio;
      const x0 = Math.floor(srcX);
      const y0 = Math.floor(srcY);
      const x1 = Math.min(x0 + 1, srcW - 1);
      const y1 = Math.min(y0 + 1, srcH - 1);
      const xFrac = srcX - x0;
      const yFrac = srcY - y0;

      for (let c = 0; c < 3; c++) {
        const topLeft = srcData[(y0 * srcW + x0) * 3 + c];
        const topRight = srcData[(y0 * srcW + x1) * 3 + c];
        const bottomLeft = srcData[(y1 * srcW + x0) * 3 + c];
        const bottomRight = srcData[(y1 * srcW + x1) * 3 + c];
        const top = topLeft + (topRight - topLeft) * xFrac;
        const bottom = bottomLeft + (bottomRight - bottomLeft) * xFrac;
        dst[(y * dstW + x) * 3 + c] = Math.round(top + (bottom - top) * yFrac);
      }
    }
  }
  return dst;
}
