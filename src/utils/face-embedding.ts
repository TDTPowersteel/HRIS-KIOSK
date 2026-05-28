export const MODEL_CONFIG = {
  name: 'buffalo_sc',
  inputSize: 112,
  channels: 3,
  matchThreshold: 0.28,
} as const;

export function compareEmbeddings(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Embedding dimension mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export function isMatch(similarity: number, threshold?: number): boolean {
  return similarity >= (threshold ?? MODEL_CONFIG.matchThreshold);
}
