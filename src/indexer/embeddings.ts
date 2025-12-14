/**
 * Semantic search using embeddings
 * Provides vector-based search for better semantic matching
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import { pipeline, env } from '@xenova/transformers';
import type { DocumentChunk } from './chunker.js';

// Configure transformers.js for local execution
env.allowLocalModels = true;
env.allowRemoteModels = true;

export interface EmbeddingVector {
  chunkId: string;
  embedding: number[];
}

export interface SemanticSearchResult {
  chunkId: string;
  similarity: number;
  chunk?: DocumentChunk;
}

/**
 * Embedding generator using transformers.js
 * Uses all-MiniLM-L6-v2 model for fast, efficient embeddings
 */
export class EmbeddingGenerator {
  private pipeline: Awaited<ReturnType<typeof pipeline>> | null = null;
  private modelName = 'Xenova/all-MiniLM-L6-v2';
  private initialized = false;

  /**
   * Initialize the embedding pipeline
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    console.error('Initializing embedding model...');
    console.error(`Model: ${this.modelName}`);

    try {
      this.pipeline = await pipeline('feature-extraction', this.modelName);
      this.initialized = true;
      console.error('Embedding model initialized successfully');
    } catch (error) {
      console.error('Failed to initialize embedding model:', error);
      throw error;
    }
  }

  /**
   * Generate embedding for a single text
   */
  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.initialized || !this.pipeline) {
      await this.initialize();
    }

    if (!this.pipeline) {
      throw new Error('Embedding pipeline not initialized');
    }

    try {
      // Generate embedding
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      const output: any = await (this.pipeline as any)(text, {
        pooling: 'mean',
        normalize: true,
      });

      // Extract embedding array
      const embedding = Array.from(output.data as Float32Array);

      return embedding;
    } catch (error) {
      console.error('Failed to generate embedding:', error);
      throw error;
    }
  }

  /**
   * Generate embeddings for multiple texts in batch
   */
  async generateEmbeddings(texts: string[], batchSize = 32): Promise<number[][]> {
    if (!this.initialized || !this.pipeline) {
      await this.initialize();
    }

    const embeddings: number[][] = [];

    // Process in batches to avoid memory issues
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);

      // We can process these in parallel promises for better CPU utilization
      // if the underlying runtime supports it, otherwise it's just concurrent JS
      const batchPromises = batch.map((text) => this.generateEmbedding(text));
      const batchResults = await Promise.all(batchPromises);

      embeddings.push(...batchResults);

      if (i + batchSize < texts.length) {
        // Progress indicator
        process.stdout.write(
          `\r  Generating embeddings: ${Math.min(i + batchSize, texts.length)}/${texts.length}  `
        );
      }
    }

    // eslint-disable-next-line no-console
    console.log(); // New line after progress
    return embeddings;
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  static cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have the same length');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      dotProduct += a[i]! * b[i]!;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      normA += a[i]! * a[i]!;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      normB += b[i]! * b[i]!;
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Find top-k most similar embeddings
   */
  static findTopK(
    queryEmbedding: number[],
    embeddings: EmbeddingVector[],
    k: number = 10
  ): SemanticSearchResult[] {
    const results: SemanticSearchResult[] = [];

    for (const item of embeddings) {
      const similarity = this.cosineSimilarity(queryEmbedding, item.embedding);
      results.push({
        chunkId: item.chunkId,
        similarity,
      });
    }

    // Sort by similarity (descending) and return top k
    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, k);
  }
}

/**
 * Embedding storage interface
 */
export interface EmbeddingStorage {
  /**
   * Store embeddings for chunks
   */
  storeEmbeddings(embeddings: EmbeddingVector[]): Promise<void>;

  /**
   * Get all embeddings
   */
  getAllEmbeddings(): Promise<EmbeddingVector[]>;

  /**
   * Get embedding by chunk ID
   */
  getEmbedding(chunkId: string): Promise<EmbeddingVector | undefined>;

  /**
   * Delete embeddings for a document
   */
  deleteEmbeddings(documentId: number): Promise<void>;

  /**
   * Search using embeddings
   */
  searchSemantic(queryEmbedding: number[], limit: number): Promise<SemanticSearchResult[]>;
}

/**
 * In-memory embedding cache
 * For fast semantic search without database overhead
 */
export class InMemoryEmbeddingCache implements EmbeddingStorage {
  private embeddings = new Map<string, number[]>();

  // eslint-disable-next-line @typescript-eslint/require-await
  async storeEmbeddings(embeddings: EmbeddingVector[]): Promise<void> {
    for (const item of embeddings) {
      this.embeddings.set(item.chunkId, item.embedding);
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getAllEmbeddings(): Promise<EmbeddingVector[]> {
    const results: EmbeddingVector[] = [];
    for (const [chunkId, embedding] of this.embeddings.entries()) {
      results.push({ chunkId, embedding });
    }
    return results;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getEmbedding(chunkId: string): Promise<EmbeddingVector | undefined> {
    const embedding = this.embeddings.get(chunkId);
    return embedding ? { chunkId, embedding } : undefined;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async deleteEmbeddings(documentId: number): Promise<void> {
    // Delete all embeddings for chunks belonging to this document
    // Chunk IDs contain document hash, so we can match by prefix
    const documentPrefix = documentId.toString();
    for (const chunkId of this.embeddings.keys()) {
      if (chunkId.startsWith(documentPrefix)) {
        this.embeddings.delete(chunkId);
      }
    }
  }

  async searchSemantic(queryEmbedding: number[], limit: number): Promise<SemanticSearchResult[]> {
    const allEmbeddings = await this.getAllEmbeddings();
    return EmbeddingGenerator.findTopK(queryEmbedding, allEmbeddings, limit);
  }

  /**
   * Get cache size
   */
  size(): number {
    return this.embeddings.size;
  }

  /**
   * Clear all embeddings
   */
  clear(): void {
    this.embeddings.clear();
  }

  /**
   * Save embeddings to file
   */
  async saveToFile(path: string): Promise<void> {
    const data = Array.from(this.embeddings.entries());
    const json = JSON.stringify(data);

    const { writeFile } = await import('fs/promises');
    await writeFile(path, json, 'utf-8');
  }

  /**
   * Load embeddings from file
   */
  async loadFromFile(path: string): Promise<void> {
    const { readFile } = await import('fs/promises');
    const json = await readFile(path, 'utf-8');
    const data = JSON.parse(json) as Array<[string, number[]]>;

    this.embeddings.clear();
    for (const [chunkId, embedding] of data) {
      this.embeddings.set(chunkId, embedding);
    }
  }
}

/**
 * Hybrid search: Combine FTS and semantic search
 */
export interface HybridSearchResult {
  chunkId: string;
  ftsScore: number;
  semanticScore: number;
  combinedScore: number;
}

export class HybridSearch {
  /**
   * Combine FTS and semantic search results
   * @param ftsResults Results from FTS search with rank scores
   * @param semanticResults Results from semantic search with similarity scores
   * @param ftsWeight Weight for FTS scores (0-1)
   * @param semanticWeight Weight for semantic scores (0-1)
   */
  static combine(
    ftsResults: Array<{ id: string; rank: number }>,
    semanticResults: SemanticSearchResult[],
    ftsWeight: number = 0.5,
    semanticWeight: number = 0.5
  ): HybridSearchResult[] {
    // Normalize weights
    const totalWeight = ftsWeight + semanticWeight;
    const normFtsWeight = ftsWeight / totalWeight;
    const normSemanticWeight = semanticWeight / totalWeight;

    // Create result map
    const resultMap = new Map<string, HybridSearchResult>();

    // Add FTS results
    // FTS rank is negative (lower is better), so we invert it
    const maxFtsRank = Math.max(...ftsResults.map((r) => Math.abs(r.rank)));
    for (const result of ftsResults) {
      const normalizedScore = 1 - Math.abs(result.rank) / maxFtsRank;
      resultMap.set(result.id, {
        chunkId: result.id,
        ftsScore: normalizedScore,
        semanticScore: 0,
        combinedScore: normalizedScore * normFtsWeight,
      });
    }

    // Add semantic results
    for (const result of semanticResults) {
      const existing = resultMap.get(result.chunkId);
      if (existing) {
        existing.semanticScore = result.similarity;
        existing.combinedScore += result.similarity * normSemanticWeight;
      } else {
        resultMap.set(result.chunkId, {
          chunkId: result.chunkId,
          ftsScore: 0,
          semanticScore: result.similarity,
          combinedScore: result.similarity * normSemanticWeight,
        });
      }
    }

    // Convert to array and sort by combined score
    const results = Array.from(resultMap.values());
    results.sort((a, b) => b.combinedScore - a.combinedScore);

    return results;
  }

  /**
   * Calculate reciprocal rank fusion
   * Better method for combining ranked lists
   */
  static reciprocalRankFusion(
    ftsResults: Array<{ id: string; rank: number }>,
    semanticResults: SemanticSearchResult[],
    k: number = 60
  ): HybridSearchResult[] {
    const scores = new Map<string, number>();

    // Add FTS results
    ftsResults.forEach((result, index) => {
      const score = 1 / (k + index + 1);
      scores.set(result.id, score);
    });

    // Add semantic results
    semanticResults.forEach((result, index) => {
      const score = 1 / (k + index + 1);
      const existing = scores.get(result.chunkId) || 0;
      scores.set(result.chunkId, existing + score);
    });

    // Convert to results
    const results: HybridSearchResult[] = [];
    for (const [chunkId, combinedScore] of scores.entries()) {
      const ftsResult = ftsResults.find((r) => r.id === chunkId);
      const semanticResult = semanticResults.find((r) => r.chunkId === chunkId);

      results.push({
        chunkId,
        ftsScore: ftsResult ? 1 : 0,
        semanticScore: semanticResult ? semanticResult.similarity : 0,
        combinedScore,
      });
    }

    results.sort((a, b) => b.combinedScore - a.combinedScore);
    return results;
  }
}
