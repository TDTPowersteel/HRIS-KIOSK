export const MODEL_CONFIG = {
  name: 'buffalo_sc',
  inputSize: 112,
  channels: 3,
  matchThreshold: 0.35,
  subThreshold: 0.28,
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

/**
 * Compare a live embedding against stored embeddings (single or multi-angle).
 * For multi-angle: compares against each angle individually and returns the MAX similarity.
 * This avoids the accuracy loss from averaging embeddings during registration.
 */
export function compareMultiAngleEmbeddings(
  liveEmbedding: number[],
  storedEmbedding: number[] | number[][]
): { maxSimilarity: number; bestAngleIndex: number; perAngleScores: number[]; angleCount: number } {
  let embeddingsList: number[][];

  if (storedEmbedding.length > 0 && Array.isArray(storedEmbedding[0])) {
    embeddingsList = storedEmbedding as number[][];
  } else {
    embeddingsList = [storedEmbedding as number[]];
  }

  let maxSimilarity = -1;
  let bestAngleIndex = -1;
  const perAngleScores: number[] = [];

  for (let i = 0; i < embeddingsList.length; i++) {
    const angleEmb = embeddingsList[i];
    if (!Array.isArray(angleEmb) || angleEmb.length < 64 || angleEmb.length !== liveEmbedding.length) {
      perAngleScores.push(-1);
      continue;
    }

    const sim = compareEmbeddings(liveEmbedding, angleEmb);
    perAngleScores.push(sim);

    if (Number.isFinite(sim) && sim > maxSimilarity) {
      maxSimilarity = sim;
      bestAngleIndex = i;
    }
  }

  return {
    maxSimilarity,
    bestAngleIndex,
    perAngleScores,
    angleCount: embeddingsList.length,
  };
}
