/**
 * Example Service - Intelligent code example retrieval for AI
 * Uses multi-strategy search with query expansion and relevance scoring
 */

import { DocumentStore } from '../indexer/store.js';
import { EmbeddingGenerator } from '../indexer/embeddings.js';
import {
  tokenizeQuery,
  calculateRelevanceScore,
  deduplicateAndRank,
  type TokenizedQuery,
  type ScoredResult,
} from './search-utils.js';
import path from 'path';

// Singleton instance for the embedding generator
let embeddingGeneratorInstance: EmbeddingGenerator | null = null;

async function getEmbeddingGenerator(): Promise<EmbeddingGenerator> {
  if (!embeddingGeneratorInstance) {
    embeddingGeneratorInstance = new EmbeddingGenerator();
    await embeddingGeneratorInstance.initialize();
  }
  return embeddingGeneratorInstance;
}

export interface CodeExample {
  code: string;
  language: string;
  description: string;
  relevanceScore: number;
  matchReasons: string[];
  context: {
    sectionHeading: string;
    sectionContent: string;
    documentTitle: string;
    documentUrl: string;
    category: string;
  };
  metadata: {
    loader: string;
    minecraftVersion: string | null;
    caption?: string;
  };
}

export interface ExampleSearchOptions {
  topic: string;
  language?: string;
  minecraftVersion?: string;
  loader?: string;
  category?: string;
  limit?: number;
}

interface CodeBlockResult {
  id: number;
  language: string;
  code: string;
  caption: string | null;
  section_heading: string;
  section_level: number;
  section_content: string;
  document_id: number;
  document_title: string;
  document_url: string;
  category: string;
  loader: string;
  minecraft_version: string | null;
}

export class ExampleService {
  private store: DocumentStore;

  constructor(dbPath?: string) {
    const finalPath =
      dbPath || process.env.DB_PATH || path.join(process.cwd(), 'data', 'mcmodding-docs.db');
    console.error(`[ExampleService] Using database at: ${finalPath}`);
    this.store = new DocumentStore(finalPath);
  }

  /**
   * Get code examples using intelligent multi-strategy search
   */
  async getExamples(options: ExampleSearchOptions): Promise<CodeExample[]> {
    const { topic, language, minecraftVersion, loader, category, limit = 5 } = options;

    console.error(`[ExampleService] Searching for: "${topic}"`);

    // Tokenize and expand query
    const query = tokenizeQuery(topic);
    console.error(`[ExampleService] Tokens: ${query.tokens.join(', ')}`);
    console.error(`[ExampleService] Expanded: ${query.expandedTokens.slice(0, 10).join(', ')}...`);
    console.error(`[ExampleService] FTS Query: ${query.ftsQuery}`);

    // Collect results from multiple strategies
    const allResults: ScoredResult<CodeBlockResult>[] = [];

    // Strategy 0: Semantic Search (Embeddings)
    try {
      const semanticResults = await this.searchViaEmbeddings(topic, {
        loader,
        minecraftVersion,
        category,
      });
      allResults.push(...semanticResults);
      console.error(`[ExampleService] Strategy 0 (semantic): ${semanticResults.length} results`);
    } catch (error) {
      console.error('[ExampleService] Semantic search failed (skipping):', error);
    }

    // Strategy 1: Search chunks with FTS/LIKE fallback, then get code blocks
    const chunkResults = this.searchViaChunks(query, {
      language,
      minecraftVersion,
      loader,
      category,
    });
    allResults.push(...chunkResults);
    console.error(`[ExampleService] Strategy 1 (chunks): ${chunkResults.length} results`);

    // Strategy 2: Direct code pattern search
    if (query.codePatterns.length > 0) {
      const codeResults = this.searchViaCodePatterns(query, {
        language,
        minecraftVersion,
        loader,
      });
      allResults.push(...codeResults);
      console.error(`[ExampleService] Strategy 2 (code patterns): ${codeResults.length} results`);
    }

    // Strategy 3: Document title/content search for related documents
    const docResults = this.searchViaDocuments(query, {
      language,
      minecraftVersion,
      loader,
      category,
    });
    allResults.push(...docResults);
    console.error(`[ExampleService] Strategy 3 (documents): ${docResults.length} results`);

    // Strategy 4: Fallback - get all code blocks and score them
    if (allResults.length < limit) {
      const fallbackResults = this.fallbackSearch(query, {
        language,
        minecraftVersion,
        loader,
        limit: limit * 3,
      });
      allResults.push(...fallbackResults);
      console.error(`[ExampleService] Strategy 4 (fallback): ${fallbackResults.length} results`);
    }

    // Deduplicate and rank
    const ranked = deduplicateAndRank(allResults, limit);
    console.error(`[ExampleService] After dedup/rank: ${ranked.length} results`);

    // Convert to CodeExample format
    const examples = ranked.map((r) => this.toCodeExample(r.item, r.score, r.matchReasons));

    return examples;
  }

  /**
   * Get the latest Minecraft version from indexed documentation
   */
  getLatestMinecraftVersion(): string {
    // 1.21.10 is the latest stable as of June 2024
    const versions = this.store.getAllVersions().sort((a, b) => {
      const aParts = a.split('.').map(Number);
      const bParts = b.split('.').map(Number);
      for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
        const aNum = aParts[i] || 0;
        const bNum = bParts[i] || 0;
        if (aNum !== bNum) {
          return bNum - aNum; // Descending order
        }
      }
      return 0;
    });
    console.error(`[ExampleService] Available versions: ${versions.join(', ')}`);
    if (versions.length === 0) {
      return '1.21.4'; // Fallback default
    }
    // Versions are sorted DESC by the store, so first is latest
    return versions[0] || '1.21.4';
  }

  /**
   * Strategy 0: Semantic Search using Embeddings
   */
  private async searchViaEmbeddings(
    topic: string,
    options: {
      loader?: string;
      minecraftVersion?: string;
      category?: string;
    }
  ): Promise<ScoredResult<CodeBlockResult>[]> {
    const generator = await getEmbeddingGenerator();
    const embedding = await generator.generateEmbedding(topic);

    // Find similar chunks (text or code)
    // We ask for more results because we'll filter for code blocks later
    const similarChunks = this.store.findSimilarChunks(embedding, {
      limit: 20,
      loader: options.loader,
      minecraftVersion: options.minecraftVersion,
      category: options.category,
    });

    const results: ScoredResult<CodeBlockResult>[] = [];
    const processedDocIds = new Set<number>();

    for (const chunk of similarChunks) {
      // Avoid processing the same document multiple times from different chunks
      if (processedDocIds.has(chunk.document_id)) continue;
      processedDocIds.add(chunk.document_id);

      // Get all code blocks for the document of the similar chunk
      const codeBlocks = this.store.getCodeBlocksForDocument(chunk.document_id);

      for (const block of codeBlocks) {
        // Calculate a score based on semantic similarity of the parent chunk
        // We use the similarity score from the embedding search

        let score = chunk.similarity || 0; // similarity is 0-1 (cosine)

        // Boost if the code block is in the same section as the matched text chunk
        if (block.section_heading === chunk.section_heading) {
          score *= 1.2;
        }

        // Normalize to our 0-100 scale (cosine is -1 to 1, but usually 0-1 for text)
        // Let's assume 0.7 is a good match.
        // We map 0.5-1.0 to 50-100.
        const normalizedScore = Math.max(0, (score - 0.3) * (100 / 0.7));

        results.push({
          item: {
            id: block.id,
            language: block.language,
            code: block.code,
            caption: block.caption,
            section_heading: block.section_heading,
            section_level: block.section_level,
            section_content: block.section_content,
            document_id: block.document_id,
            document_title: block.document_title,
            document_url: block.document_url,
            category: block.category,
            loader: block.loader,
            minecraft_version: block.minecraft_version,
          },
          score: normalizedScore,
          matchReasons: [
            `Semantic match with "${chunk.section_heading}" (${(score * 100).toFixed(0)}%)`,
          ],
        });
      }
    }

    return results;
  }

  /**
   * Strategy 1: Search via chunks (FTS + LIKE fallback)
   */
  private searchViaChunks(
    query: TokenizedQuery,
    options: {
      language?: string;
      minecraftVersion?: string;
      loader?: string;
      category?: string;
    }
  ): ScoredResult<CodeBlockResult>[] {
    const results: ScoredResult<CodeBlockResult>[] = [];

    // Search chunks
    const chunks = this.store.searchChunksAdvanced(query.ftsQuery, query.likePatterns, {
      hasCode: true,
      language: options.language,
      loader: options.loader,
      minecraftVersion: options.minecraftVersion,
      category: options.category,
      limit: 100,
    });

    // Get code blocks for each matching chunk's document
    const seenDocIds = new Set<number>();

    for (const chunk of chunks) {
      if (seenDocIds.has(chunk.document_id)) continue;
      seenDocIds.add(chunk.document_id);

      const codeBlocks = this.store.getCodeBlocksWithContext(chunk.document_id);

      for (const block of codeBlocks) {
        // Filter by language if specified
        if (options.language && block.language !== options.language) continue;

        const { score, reasons } = calculateRelevanceScore(
          {
            title: block.document_title,
            section_heading: block.section_heading,
            section_content: block.section_content,
            code: block.code,
            caption: block.caption,
            category: block.category,
            url: block.document_url,
          },
          query
        );

        if (score > 0) {
          results.push({
            item: block,
            score,
            matchReasons: reasons,
          });
        }
      }
    }

    return results;
  }

  /**
   * Strategy 2: Search via code patterns
   */
  private searchViaCodePatterns(
    query: TokenizedQuery,
    options: {
      language?: string;
      minecraftVersion?: string;
      loader?: string;
    }
  ): ScoredResult<CodeBlockResult>[] {
    const results: ScoredResult<CodeBlockResult>[] = [];

    const codeBlocks = this.store.searchCodeBlocksByPatterns(query.codePatterns, {
      language: options.language,
      loader: options.loader,
      minecraftVersion: options.minecraftVersion,
      limit: 50,
    });

    for (const block of codeBlocks) {
      const { score, reasons } = calculateRelevanceScore(
        {
          title: block.document_title,
          section_heading: block.section_heading,
          section_content: block.section_content,
          code: block.code,
          caption: block.caption,
          category: block.category,
          url: block.document_url,
        },
        query
      );

      // Boost score for code pattern matches
      const boostedScore = score + 30;

      results.push({
        item: block,
        score: boostedScore,
        matchReasons: [...reasons, 'code pattern match'],
      });
    }

    return results;
  }

  /**
   * Strategy 3: Search via document title/content
   */
  private searchViaDocuments(
    query: TokenizedQuery,
    options: {
      language?: string;
      minecraftVersion?: string;
      loader?: string;
      category?: string;
    }
  ): ScoredResult<CodeBlockResult>[] {
    const results: ScoredResult<CodeBlockResult>[] = [];

    const docs = this.store.searchDocumentsLike(query.likePatterns, {
      loader: options.loader,
      minecraftVersion: options.minecraftVersion,
      category: options.category,
      limit: 15,
    });

    for (const doc of docs) {
      const codeBlocks = this.store.getCodeBlocksWithContext(doc.id);

      for (const block of codeBlocks) {
        // Filter by language if specified
        if (options.language && block.language !== options.language) continue;

        const { score, reasons } = calculateRelevanceScore(
          {
            title: block.document_title,
            section_heading: block.section_heading,
            section_content: block.section_content,
            code: block.code,
            caption: block.caption,
            category: block.category,
            url: block.document_url,
          },
          query
        );

        if (score > 0) {
          results.push({
            item: block,
            score,
            matchReasons: reasons,
          });
        }
      }
    }

    return results;
  }

  /**
   * Strategy 4: Fallback - get all code blocks and score them client-side
   */
  private fallbackSearch(
    query: TokenizedQuery,
    options: {
      language?: string;
      minecraftVersion?: string;
      loader?: string;
      limit?: number;
    }
  ): ScoredResult<CodeBlockResult>[] {
    const results: ScoredResult<CodeBlockResult>[] = [];

    const codeBlocks = this.store.getAllCodeBlocksWithContext({
      language: options.language,
      loader: options.loader,
      minecraftVersion: options.minecraftVersion,
      limit: options.limit || 100,
    });

    for (const block of codeBlocks) {
      const { score, reasons } = calculateRelevanceScore(
        {
          title: block.document_title,
          section_heading: block.section_heading,
          section_content: block.section_content,
          code: block.code,
          caption: block.caption,
          category: block.category,
          url: block.document_url,
        },
        query
      );

      // Only include if score is above minimum threshold
      if (score >= 10) {
        results.push({
          item: block,
          score,
          matchReasons: reasons,
        });
      }
    }

    return results;
  }

  /**
   * Convert a code block result to CodeExample format
   */
  private toCodeExample(
    block: CodeBlockResult,
    score: number,
    matchReasons: string[]
  ): CodeExample {
    return {
      code: block.code,
      language: block.language,
      description: this.generateDescription(block),
      relevanceScore: score,
      matchReasons,
      context: {
        sectionHeading: block.section_heading,
        sectionContent: this.truncateContent(block.section_content, 500),
        documentTitle: block.document_title,
        documentUrl: block.document_url,
        category: block.category,
      },
      metadata: {
        loader: block.loader,
        minecraftVersion: block.minecraft_version,
        caption: block.caption || undefined,
      },
    };
  }

  /**
   * Generate a description for a code block
   */
  private generateDescription(block: CodeBlockResult): string {
    if (block.caption) {
      return block.caption;
    }

    // Try to extract first meaningful sentence from section content
    const sentences = block.section_content.split(/[.!?]+/);
    if (sentences.length > 0 && sentences[0] && sentences[0].trim().length > 10) {
      const firstSentence = sentences[0].trim();
      if (firstSentence.length <= 200) {
        return firstSentence;
      }
      return firstSentence.substring(0, 197) + '...';
    }

    return `Code example from "${block.section_heading}" in ${block.document_title}`;
  }

  /**
   * Truncate content intelligently at sentence boundaries
   */
  private truncateContent(content: string, maxLength: number): string {
    if (content.length <= maxLength) {
      return content;
    }

    const truncated = content.substring(0, maxLength);
    const lastPeriod = truncated.lastIndexOf('.');
    const lastQuestion = truncated.lastIndexOf('?');
    const lastExclamation = truncated.lastIndexOf('!');

    const lastSentenceEnd = Math.max(lastPeriod, lastQuestion, lastExclamation);

    if (lastSentenceEnd > maxLength * 0.7) {
      return truncated.substring(0, lastSentenceEnd + 1);
    }

    const lastSpace = truncated.lastIndexOf(' ');
    if (lastSpace > maxLength * 0.8) {
      return truncated.substring(0, lastSpace) + '...';
    }

    return truncated + '...';
  }

  /**
   * Get available example topics based on indexed content
   */
  getAvailableTopics(): {
    categories: string[];
    languages: Array<{ language: string; count: number }>;
    loaders: string[];
    versions: string[];
  } {
    const stats = this.store.getStats();
    const languages = this.store.getAvailableLanguages();
    const versions = this.store.getAllVersions();

    return {
      categories: Object.keys(stats.loaders),
      languages,
      loaders: ['fabric', 'neoforge', 'shared'],
      versions,
    };
  }

  /**
   * Format examples for AI-friendly output
   */
  formatForAI(examples: CodeExample[]): string {
    if (examples.length === 0) {
      return 'No code examples found for the specified criteria.';
    }

    let output = `Found ${examples.length} relevant code example${examples.length > 1 ? 's' : ''} for minecraft version ${examples[0]?.metadata.minecraftVersion || 'unknown'}:\n\n`;

    for (let i = 0; i < examples.length; i++) {
      const example = examples[i];
      if (!example) continue;

      output += `## Example ${i + 1}: ${example.context.sectionHeading}\n\n`;

      if (example.description) {
        output += `**Description:** ${example.description}\n\n`;
      }

      output += `**Source:** ${example.context.documentTitle}\n`;
      output += `**Category:** ${example.context.category}\n`;
      output += `**Loader:** ${example.metadata.loader}\n`;

      if (example.metadata.minecraftVersion) {
        output += `**Minecraft Version:** ${example.metadata.minecraftVersion}\n`;
      }

      output += `**URL:** ${example.context.documentUrl}\n`;
      output += `**Relevance:** ${example.relevanceScore} (${example.matchReasons.slice(0, 3).join(', ')})\n\n`;

      output += `\`\`\`${example.language}\n${example.code}\n\`\`\`\n\n`;

      if (example.context.sectionContent && example.context.sectionContent.length > 50) {
        output += `**Context:**\n${example.context.sectionContent}\n\n`;
      }

      output += '---\n\n';
    }

    return output;
  }

  /**
   * Close database connection
   */
  close() {
    this.store.close();
  }
}
