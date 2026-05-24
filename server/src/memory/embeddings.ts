/**
 * Local deterministic embedder.
 *
 * Hashes 1- and 2-grams into a 256-dim float vector using a single
 * FNV-1a hash. Not as good as a real embedding model — but completely
 * dependency-free, deterministic, and produces a usable cosine-similarity
 * space for the kinds of short tech-support ticket texts Relay sees.
 *
 * Upgrade path: drop in OpenAI / Voyage / Cohere; replace `embed()` and
 * re-index with a different `model` string. The TicketEmbedding.model
 * column tracks which embedder produced each row so a re-index can
 * filter mismatched vectors.
 */

const DIM = 256;
const STOPWORDS = new Set([
  "the","a","an","and","or","but","of","to","in","for","on","at","with",
  "is","are","was","were","be","been","being",
  "i","me","my","we","our","you","your","he","she","it","they","them",
  "this","that","these","those","im","ive","cant","dont","doesnt","wont",
  "cannot","please","help","thanks","thank","hi","hello",
]);

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

// FNV-1a 32-bit hash → bucket in [0, DIM).
function bucket(token: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i += 1) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % DIM);
}

export const MODEL_KEY = "local-hash-256";

export function embed(text: string): number[] {
  const v = new Float32Array(DIM);
  const tokens = tokenize(text);

  // Unigrams + bigrams.
  for (let i = 0; i < tokens.length; i += 1) {
    v[bucket(tokens[i]!)]! += 1;
    if (i + 1 < tokens.length) {
      v[bucket(`${tokens[i]} ${tokens[i + 1]}`)]! += 1;
    }
  }

  // L2-normalise so cosine similarity is just a dot product.
  let norm = 0;
  for (let i = 0; i < DIM; i += 1) norm += v[i]! * v[i]!;
  norm = Math.sqrt(norm);
  if (norm === 0) return Array.from(v);
  for (let i = 0; i < DIM; i += 1) v[i]! /= norm;
  return Array.from(v);
}

export function cosine(a: number[] | Float32Array, b: number[] | Float32Array): number {
  // Both are L2-normalised → just a dot product.
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) dot += a[i]! * b[i]!;
  return dot;
}
