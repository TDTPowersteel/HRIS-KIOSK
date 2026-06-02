import { InferenceSession, Tensor } from 'onnxruntime-react-native';
import { Platform } from 'react-native';
import { Asset } from 'expo-asset';
import { File, Paths } from 'expo-file-system';

let session: InferenceSession | null = null;

export async function loadFaceModel(): Promise<void> {
  if (session) return;

  const asset = Asset.fromModule(require('../../assets/models/w600k_mbf.onnx'));
  await asset.downloadAsync();

  if (!asset.localUri) {
    throw new Error('Failed to resolve local URI for model asset.');
  }

  const file = new File(Paths.document, 'w600k_mbf.onnx');
  if (!file.exists) {
    const sourceFile = new File(asset.localUri);
    sourceFile.copy(file);
  }

  const cleanPath = file.uri.replace('file://', '');
  session = await InferenceSession.create(cleanPath, {
    executionProviders: Platform.OS === 'ios'
      ? ['coreml', 'xnnpack', 'cpu']
      : ['xnnpack', 'cpu'],
    graphOptimizationLevel: 'all',
    enableCpuMemArena: true,
    enableMemPattern: true,
  });

  console.log(`[FaceEngine] buffalo_sc ONNX model loaded (${Platform.OS === 'ios' ? 'CoreML→' : ''}XNNPACK→CPU)`);
}

export function isModelLoaded(): boolean {
  return session !== null;
}

export async function getEmbedding(pixels: Float32Array): Promise<Float32Array> {
  if (!session) throw new Error('Model not loaded. Call loadFaceModel() first.');

  const inputTensor = new Tensor('float32', pixels, [1, 3, 112, 112]);
  
  // Build feeds object with all input names to be safe
  const feeds: any = {};
  session.inputNames.forEach((name: string) => {
    feeds[name] = inputTensor;
  });

  const result = await session.run(feeds);

  // Use the first output name or fallback
  const outputKey = session.outputNames[0] || Object.keys(result)[0] || 'output';
  return result[outputKey].data as Float32Array;
}
