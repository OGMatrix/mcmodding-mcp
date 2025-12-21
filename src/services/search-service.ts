/**
 * Search Service - Intelligent documentation search for AI
 * Uses multi-strategy search with query expansion and relevance scoring
 */

import { DocumentStore } from '../indexer/store.js';
import { EmbeddingGenerator } from '../indexer/embeddings.js';
import {
  tokenizeQuery,
  calculateRelevanceScore,
  type TokenizedQuery,
  type ScoredResult,
} from './search-utils.js';
import path from 'path';

export interface SearchResult {
  title: string;
  url: string;
  category: string;
  loader: string;
  minecraftVersion: string | null;
  relevanceScore: number;
  matchReasons: string[];
  snippet: string;
  sections: Array<{
    heading: string;
    content: string;
    hasCode: boolean;
  }>;
}

export interface SearchOptions {
  query: string;
  category?: string;
  loader?: string;
  minecraftVersion?: string;
  includeCode?: boolean;
  limit?: number;
}

interface DocumentResult {
  id: number;
  url: string;
  title: string;
  content: string;
  category: string;
  loader: string;
  minecraft_version: string | null;
}

interface ChunkResult {
  id: string;
  content: string;
  chunk_type: string;
  section_heading: string | null;
  section_level: number | null;
  code_language: string | null;
  has_code: number;
  document_id: number;
  url: string;
  title: string;
  category: string;
  loader: string;
  minecraft_version: string | null;
}

interface SectionResult {
  id: number;
  heading: string;
  level: number;
  content: string;
  order_num: number;
  document_id: number;
  document_title: string;
  document_url: string;
  category: string;
  loader: string;
  minecraft_version: string | null;
}

/**
 * UI/Navigation noise patterns to strip from content
 */
const NOISE_PATTERNS = [
  // Language selectors
  /Search🇺🇸.*?(?=\n|$)/gi,
  /🇺🇸\s*English.*?(?=\n|$)/gi,
  /🇨🇿\s*Čeština.*?(?=\n|$)/gi,
  /🇩🇪\s*Deutsch.*?(?=\n|$)/gi,
  /🇬🇷\s*Ελληνικά.*?(?=\n|$)/gi,
  /🇪🇸\s*Español.*?(?=\n|$)/gi,
  /🇫🇷\s*Français.*?(?=\n|$)/gi,
  /🇮🇹\s*Italiano.*?(?=\n|$)/gi,
  /🇯🇵\s*日本語.*?(?=\n|$)/gi,
  /🇰🇷\s*한국어.*?(?=\n|$)/gi,
  /🇵🇱\s*Polski.*?(?=\n|$)/gi,
  /🇧🇷\s*Português.*?(?=\n|$)/gi,
  /🇷🇺\s*Русский.*?(?=\n|$)/gi,
  /🇺🇦\s*Українська.*?(?=\n|$)/gi,
  /🇻🇳\s*Tiếng Việt.*?(?=\n|$)/gi,
  // Common navigation elements
  /\(US\).*?\(Việt.*?\)/gs,
  /English \(US\).*$/gm,
  // Flag emoji sequences
  /[\u{1F1E6}-\u{1F1FF}]{2}\s*[A-Za-zÀ-ÿ\u0400-\u04FF\u0370-\u03FF\u4E00-\u9FFF\uAC00-\uD7AF]+\s*\([^)]+\)/gu,
];

/**
 * Version pattern to extract from query
 */
const VERSION_PATTERN = /\b(1\.(?:2[0-9]|1[0-9]|[0-9])(?:\.[0-9]+)?)\b/;

export class SearchService {
  private store: DocumentStore;
  private embeddingGenerator: EmbeddingGenerator;

  constructor(dbPath?: string) {
    const finalPath =
      dbPath || process.env.DB_PATH || path.join(process.cwd(), 'data', 'mcmodding-docs.db');
    console.error(`[SearchService] Using database at: ${finalPath}`);
    this.store = new DocumentStore(finalPath);
    this.embeddingGenerator = new EmbeddingGenerator();
  }

  /**
   * Search documentation using intelligent multi-strategy search
   */
  async search(options: SearchOptions): Promise<SearchResult[]> {
    const { query, category, loader, includeCode = true, limit = 10 } = options;
    let { minecraftVersion } = options;

    console.error(`[SearchService] Searching for: "${query}"`);

    // Extract version from query if not explicitly provided
    const extractedVersion = this.extractVersionFromQuery(query);
    if (!minecraftVersion && extractedVersion) {
      console.error(`[SearchService] Extracted version from query: ${extractedVersion}`);
      minecraftVersion = extractedVersion;
    }

    // Tokenize and expand query
    const tokenized = tokenizeQuery(query);
    console.error(`[SearchService] Tokens: ${tokenized.tokens.join(', ')}`);
    console.error(`[SearchService] FTS Query: ${tokenized.ftsQuery}`);

    // Collect results from multiple strategies
    const allResults: ScoredResult<DocumentResult>[] = [];

    // Prepare version filter
    // If version is specified, we use it to filter strictly (with expansion)
    const versionFilter = minecraftVersion ? this.getVersionFilter(minecraftVersion) : undefined;

    // Strategy 1: Search via chunks (most precise)
    const chunkResults = this.searchViaChunks(tokenized, {
      category,
      loader,
      minecraftVersion: versionFilter, // Strict filter
      includeCode,
    });
    allResults.push(...chunkResults);
    console.error(`[SearchService] Strategy 1 (chunks): ${chunkResults.length} results`);

    // Strategy 2: Search via documents directly
    const docResults = this.searchViaDocuments(tokenized, {
      category,
      loader,
      minecraftVersion: versionFilter, // Strict filter
    });
    allResults.push(...docResults);
    console.error(`[SearchService] Strategy 2 (documents): ${docResults.length} results`);

    // Strategy 3: Search via sections
    const sectionResults = this.searchViaSections(tokenized, {
      category,
      loader,
      minecraftVersion: versionFilter, // Strict filter
    });
    allResults.push(...sectionResults);
    console.error(`[SearchService] Strategy 3 (sections): ${sectionResults.length} results`);

    // Strategy 4: Semantic Search (Embeddings)
    try {
      const embeddingResults = await this.searchViaEmbeddings(query, {
        category,
        loader,
        minecraftVersion: versionFilter, // Strict filter
        limit: 20,
      });
      allResults.push(...embeddingResults);
      console.error(`[SearchService] Strategy 4 (embeddings): ${embeddingResults.length} results`);
    } catch (error) {
      console.error('[SearchService] Embedding search failed:', error);
    }

    // Apply version boost if version was specified/extracted (still useful for ranking)
    if (minecraftVersion) {
      this.applyVersionBoost(allResults, minecraftVersion);
    }

    // Deduplicate by URL path (ignoring version), keeping best version match
    const deduplicated = this.deduplicateByUrlPath(allResults, minecraftVersion, limit * 2);
    console.error(`[SearchService] After URL dedup: ${deduplicated.length} results`);

    // Final ranking and limit
    const ranked = deduplicated.sort((a, b) => b.score - a.score).slice(0, limit);
    console.error(`[SearchService] After final rank: ${ranked.length} results`);

    // Convert to SearchResult format with sections
    const results = ranked.map((r) => this.toSearchResult(r, tokenized));

    return results;
  }

  /**
   * Get version filter string (e.g. "1.21" -> "1.21%")
   */
  private getVersionFilter(version: string): string {
    // If version is like "1.21", return "1.21%" to match "1.21.4"
    // If version is like "1.21.4", return "1.21.4" (exact)
    if (version.split('.').length === 2) {
      return version + '%';
    }
    return version;
  }

  /**
   * Strategy 4: Search via embeddings
   */
  private async searchViaEmbeddings(
    query: string,
    options: {
      category?: string;
      loader?: string;
      minecraftVersion?: string;
      limit?: number;
    }
  ): Promise<ScoredResult<DocumentResult>[]> {
    const results: ScoredResult<DocumentResult>[] = [];

    // Generate embedding for query
    const embedding = await this.embeddingGenerator.generateEmbedding(query);

    // Search similar chunks
    const chunks = this.store.findSimilarChunks(embedding, {
      loader: options.loader,
      minecraftVersion: options.minecraftVersion,
      category: options.category,
      limit: options.limit || 20,
    });

    // Group by document and score
    const docMap = new Map<number, { doc: DocumentResult; score: number; reasons: string[] }>();

    for (const chunk of chunks) {
      // Normalize similarity (cosine is -1 to 1, but usually 0 to 1 for text)
      // Scale to 0-100 range for consistency with other scores
      const score = Math.max(0, chunk.similarity) * 100;

      if (score > 50) {
        // Threshold for relevance
        const existing = docMap.get(chunk.document_id);
        if (existing) {
          existing.score = Math.max(existing.score, score);
          if (!existing.reasons.includes('semantic match')) {
            existing.reasons.push('semantic match');
          }
        } else {
          docMap.set(chunk.document_id, {
            doc: {
              id: chunk.document_id,
              url: chunk.url,
              title: chunk.title,
              content: chunk.content,
              category: chunk.category,
              loader: chunk.loader,
              minecraft_version: chunk.minecraft_version,
            },
            score,
            reasons: ['semantic match'],
          });
        }
      }
    }

    // Convert to scored results
    for (const entry of docMap.values()) {
      results.push({
        item: entry.doc,
        score: entry.score,
        matchReasons: entry.reasons,
      });
    }

    return results;
  }

  /**
   * Extract Minecraft version from query string
   */
  private extractVersionFromQuery(query: string): string | null {
    const match = query.match(VERSION_PATTERN);
    return match?.[1] ?? null;
  }

  /**
   * Apply version boost to results matching the requested version
   */
  private applyVersionBoost(results: ScoredResult<DocumentResult>[], targetVersion: string): void {
    const targetParts = targetVersion.split('.').map(Number);

    for (const result of results) {
      const docVersion = result.item.minecraft_version;
      if (!docVersion) continue;

      const docParts = docVersion.split('.').map(Number);

      // Exact version match - big boost
      if (docVersion === targetVersion) {
        result.score += 50;
        result.matchReasons.push('exact version match');
        continue;
      }

      // Same major.minor version (e.g., 1.21.x matches 1.21) - medium boost
      if (targetParts[0] === docParts[0] && targetParts[1] === docParts[1]) {
        result.score += 30;
        result.matchReasons.push('same minor version');
        continue;
      }

      // Same major version - small boost
      if (targetParts[0] === docParts[0]) {
        result.score += 10;
        result.matchReasons.push('same major version');
      }
    }
  }

  /**
   * Deduplicate results by URL path (ignoring version in path)
   * Keeps the best matching version for each unique page
   */
  private deduplicateByUrlPath(
    results: ScoredResult<DocumentResult>[],
    preferredVersion: string | undefined,
    limit: number
  ): ScoredResult<DocumentResult>[] {
    // Extract URL path without version for grouping
    const getUrlPathKey = (url: string): string => {
      // Remove version from URL path: /1.21.4/develop/blocks/first-block -> /develop/blocks/first-block
      return url.replace(/\/\d+\.\d+(?:\.\d+)?\//, '/');
    };

    // Group by URL path
    const urlGroups = new Map<string, ScoredResult<DocumentResult>[]>();

    for (const result of results) {
      const pathKey = getUrlPathKey(result.item.url);
      const existing = urlGroups.get(pathKey) || [];
      existing.push(result);
      urlGroups.set(pathKey, existing);
    }

    // For each group, pick the best result (considering version preference)
    const deduplicated: ScoredResult<DocumentResult>[] = [];

    for (const [, group] of urlGroups) {
      if (group.length === 0) continue;

      // Sort group by: 1) version match, 2) score
      const sorted = group.sort((a, b) => {
        const aVersion = a.item.minecraft_version || '';
        const bVersion = b.item.minecraft_version || '';

        // Prefer exact version match
        if (preferredVersion) {
          const aExact = aVersion === preferredVersion ? 1 : 0;
          const bExact = bVersion === preferredVersion ? 1 : 0;
          if (aExact !== bExact) return bExact - aExact;

          // Prefer same minor version
          const aSameMinor = this.isSameMinorVersion(aVersion, preferredVersion) ? 1 : 0;
          const bSameMinor = this.isSameMinorVersion(bVersion, preferredVersion) ? 1 : 0;
          if (aSameMinor !== bSameMinor) return bSameMinor - aSameMinor;
        }

        // Prefer newer versions
        const versionCompare = this.compareVersions(bVersion, aVersion);
        if (versionCompare !== 0) return versionCompare;

        // Fall back to score
        return b.score - a.score;
      });

      const best = sorted[0];
      if (best) {
        deduplicated.push(best);
      }
    }

    return deduplicated.slice(0, limit);
  }

  /**
   * Check if two versions have the same major.minor
   */
  private isSameMinorVersion(v1: string, v2: string): boolean {
    const p1 = v1.split('.').map(Number);
    const p2 = v2.split('.').map(Number);
    return p1[0] === p2[0] && p1[1] === p2[1];
  }

  /**
   * Compare two version strings (returns positive if v1 > v2)
   */
  private compareVersions(v1: string, v2: string): number {
    const p1 = v1.split('.').map(Number);
    const p2 = v2.split('.').map(Number);

    for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
      const n1 = p1[i] || 0;
      const n2 = p2[i] || 0;
      if (n1 !== n2) return n1 - n2;
    }
    return 0;
  }

  /**
   * Strategy 1: Search via chunks
   */
  private searchViaChunks(
    query: TokenizedQuery,
    options: {
      category?: string;
      loader?: string;
      minecraftVersion?: string;
      includeCode?: boolean;
    }
  ): ScoredResult<DocumentResult>[] {
    const results: ScoredResult<DocumentResult>[] = [];

    // Search chunks using FTS with LIKE fallback
    const chunks = this.store.searchChunksAdvanced(query.ftsQuery, query.likePatterns, {
      hasCode: false, // Don't filter by code - we want all content
      loader: options.loader,
      minecraftVersion: options.minecraftVersion,
      category: options.category,
      limit: 100,
    });

    // Group chunks by document and score
    const docMap = new Map<
      number,
      { doc: DocumentResult; chunks: ChunkResult[]; score: number; reasons: string[] }
    >();

    for (const chunk of chunks) {
      const { score, reasons } = calculateRelevanceScore(
        {
          title: chunk.title,
          content: chunk.content,
          section_heading: chunk.section_heading,
          url: chunk.url,
          category: chunk.category,
        },
        query
      );

      if (score > 0) {
        const existing = docMap.get(chunk.document_id);
        if (existing) {
          // Aggregate score for same document
          existing.score = Math.max(existing.score, score);
          existing.chunks.push(chunk);
          for (const reason of reasons) {
            if (!existing.reasons.includes(reason)) {
              existing.reasons.push(reason);
            }
          }
        } else {
          docMap.set(chunk.document_id, {
            doc: {
              id: chunk.document_id,
              url: chunk.url,
              title: chunk.title,
              content: chunk.content,
              category: chunk.category,
              loader: chunk.loader,
              minecraft_version: chunk.minecraft_version,
            },
            chunks: [chunk],
            score,
            reasons,
          });
        }
      }
    }

    // Convert to scored results
    for (const entry of docMap.values()) {
      results.push({
        item: entry.doc,
        score: entry.score,
        matchReasons: entry.reasons,
      });
    }

    return results;
  }

  /**
   * Strategy 2: Search via documents directly
   */
  private searchViaDocuments(
    query: TokenizedQuery,
    options: {
      category?: string;
      loader?: string;
      minecraftVersion?: string;
    }
  ): ScoredResult<DocumentResult>[] {
    const results: ScoredResult<DocumentResult>[] = [];

    const docs = this.store.searchDocumentsLike(query.likePatterns, {
      loader: options.loader,
      minecraftVersion: options.minecraftVersion,
      category: options.category,
      limit: 50,
    });

    for (const doc of docs) {
      const { score, reasons } = calculateRelevanceScore(
        {
          title: doc.title,
          content: doc.content,
          url: doc.url,
          category: doc.category,
        },
        query
      );

      if (score > 0) {
        results.push({
          item: doc,
          score,
          matchReasons: reasons,
        });
      }
    }

    return results;
  }

  /**
   * Strategy 3: Search via sections
   */
  private searchViaSections(
    query: TokenizedQuery,
    options: {
      category?: string;
      loader?: string;
      minecraftVersion?: string;
    }
  ): ScoredResult<DocumentResult>[] {
    const results: ScoredResult<DocumentResult>[] = [];

    const sections = this.store.searchSections(query.tokens.join(' '), {
      loader: options.loader,
      minecraftVersion: options.minecraftVersion,
      category: options.category,
      limit: 50,
    });

    // Group by document
    const docMap = new Map<number, { section: SectionResult; score: number; reasons: string[] }>();

    for (const section of sections) {
      const { score, reasons } = calculateRelevanceScore(
        {
          title: section.document_title,
          content: section.content,
          section_heading: section.heading,
          url: section.document_url,
          category: section.category,
        },
        query
      );

      if (score > 0) {
        const existing = docMap.get(section.document_id);
        if (!existing || score > existing.score) {
          docMap.set(section.document_id, { section, score, reasons });
        }
      }
    }

    // Convert to document results
    for (const entry of docMap.values()) {
      results.push({
        item: {
          id: entry.section.document_id,
          url: entry.section.document_url,
          title: entry.section.document_title,
          content: entry.section.content,
          category: entry.section.category,
          loader: entry.section.loader,
          minecraft_version: entry.section.minecraft_version,
        },
        score: entry.score,
        matchReasons: entry.reasons,
      });
    }

    return results;
  }

  /**
   * Convert a document result to SearchResult format
   */
  private toSearchResult(
    result: ScoredResult<DocumentResult>,
    query: TokenizedQuery
  ): SearchResult {
    const doc = result.item;

    // Get sections for this document
    const sections = this.getSectionsForDocument(doc.id, query);

    // Generate snippet from content (cleaned)
    const cleanContent = this.cleanContent(doc.content);
    const snippet = this.generateSnippet(cleanContent, query, 300);

    return {
      title: doc.title,
      url: doc.url,
      category: doc.category,
      loader: doc.loader,
      minecraftVersion: doc.minecraft_version,
      relevanceScore: result.score,
      matchReasons: result.matchReasons,
      snippet,
      sections,
    };
  }

  /**
   * Clean content by removing UI/navigation noise
   */
  private cleanContent(content: string): string {
    let cleaned = content;

    for (const pattern of NOISE_PATTERNS) {
      cleaned = cleaned.replace(pattern, '');
    }

    // Remove excessive whitespace
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
    cleaned = cleaned.replace(/[ \t]+/g, ' ');

    return cleaned.trim();
  }

  /**
   * Get relevant sections for a document
   */
  private getSectionsForDocument(
    documentId: number,
    query: TokenizedQuery
  ): Array<{ heading: string; content: string; hasCode: boolean }> {
    const sections: Array<{ heading: string; content: string; hasCode: boolean }> = [];

    // Get all chunks for this document
    const chunks = this.store.searchChunksAdvanced('', [`%${query.tokens[0] || ''}%`], {
      hasCode: false,
      limit: 100,
    });

    // Filter to this document and score
    const docChunks = chunks
      .filter((c) => c.document_id === documentId)
      .map((c) => ({
        chunk: c,
        score: calculateRelevanceScore(
          {
            content: c.content,
            section_heading: c.section_heading,
          },
          query
        ).score,
      }))
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    // Group by section heading
    const seenHeadings = new Set<string>();
    for (const { chunk } of docChunks) {
      const heading = chunk.section_heading || 'Overview';
      if (!seenHeadings.has(heading)) {
        seenHeadings.add(heading);
        const cleanedContent = this.cleanContent(chunk.content);
        sections.push({
          heading,
          content: this.truncateCodeAware(cleanedContent, 400),
          hasCode: chunk.has_code === 1,
        });
      }
    }

    return sections;
  }

  /**
   * Generate a relevant snippet from content
   */
  private generateSnippet(content: string, query: TokenizedQuery, maxLength: number): string {
    const contentLower = content.toLowerCase();

    // Try to find a section containing query tokens
    for (const token of query.tokens) {
      if (token.length < 3) continue;

      const index = contentLower.indexOf(token.toLowerCase());
      if (index !== -1) {
        // Extract context around the match
        const start = Math.max(0, index - 100);
        const end = Math.min(content.length, index + token.length + 200);

        let snippet = content.substring(start, end);

        // Clean up start
        if (start > 0) {
          const firstSpace = snippet.indexOf(' ');
          if (firstSpace > 0 && firstSpace < 20) {
            snippet = '...' + snippet.substring(firstSpace + 1);
          } else {
            snippet = '...' + snippet;
          }
        }

        // Clean up end
        if (end < content.length) {
          const lastSpace = snippet.lastIndexOf(' ');
          if (lastSpace > snippet.length - 20) {
            snippet = snippet.substring(0, lastSpace) + '...';
          } else {
            snippet = snippet + '...';
          }
        }

        const cleaned = snippet.trim();
        if (cleaned.length > 20) {
          return cleaned;
        }
      }
    }

    // Fallback: return beginning of content
    return this.truncateCodeAware(content, maxLength);
  }

  /**
   * Truncate content intelligently, avoiding cutting code mid-statement
   */
  private truncateCodeAware(content: string, maxLength: number): string {
    if (content.length <= maxLength) {
      return content;
    }

    const truncated = content.substring(0, maxLength);

    // Try to end at a complete statement
    const lastSemicolon = truncated.lastIndexOf(';');
    const lastBrace = truncated.lastIndexOf('}');
    const lastPeriod = truncated.lastIndexOf('.');
    const lastNewline = truncated.lastIndexOf('\n');

    // For code: prefer ending at semicolon or brace
    const codeEnd = Math.max(lastSemicolon, lastBrace);
    if (codeEnd > maxLength * 0.5) {
      return truncated.substring(0, codeEnd + 1).trim();
    }

    // For prose: prefer ending at sentence
    if (lastPeriod > maxLength * 0.6) {
      return truncated.substring(0, lastPeriod + 1);
    }

    // Prefer ending at newline
    if (lastNewline > maxLength * 0.7) {
      return truncated.substring(0, lastNewline).trim() + '...';
    }

    // Last resort: end at word boundary
    const lastSpace = truncated.lastIndexOf(' ');
    if (lastSpace > maxLength * 0.8) {
      return truncated.substring(0, lastSpace) + '...';
    }

    return truncated + '...';
  }

  /**
   * Get database statistics
   */
  getStats(): {
    totalDocuments: number;
    totalSections: number;
    categories: string[];
    loaders: string[];
    versions: string[];
  } {
    const stats = this.store.getStats();
    const versions = this.store.getAllVersions();

    return {
      totalDocuments: stats.totalDocuments,
      totalSections: stats.totalSections,
      categories: Object.keys(stats.loaders),
      loaders: ['fabric', 'neoforge', 'shared'],
      versions,
    };
  }

  /**
   * Format search results for AI-friendly output
   */
  formatForAI(results: SearchResult[], query: string): string {
    if (results.length === 0) {
      return `No documentation found for "${query}".`;
    }

    let output = `Found ${results.length} relevant documentation page${results.length > 1 ? 's' : ''} for "${query}":\n\n`;

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (!result) continue;

      output += `## ${i + 1}. ${result.title}\n\n`;
      output += `**URL:** ${result.url}\n`;
      output += `**Category:** ${result.category}\n`;
      output += `**Loader:** ${result.loader}\n`;

      if (result.minecraftVersion) {
        output += `**Minecraft Version:** ${result.minecraftVersion}\n`;
      }

      output += `**Relevance:** ${result.relevanceScore} (${result.matchReasons.slice(0, 3).join(', ')})\n\n`;

      if (result.snippet) {
        output += `**Summary:**\n${result.snippet}\n\n`;
      }

      if (result.sections.length > 0) {
        output += `**Key Sections:**\n`;
        for (const section of result.sections.slice(0, 3)) {
          const cleanedSection = this.truncateCodeAware(section.content, 150);
          output += `- **${section.heading}**${section.hasCode ? ' (has code)' : ''}: ${cleanedSection}\n`;
        }
        output += '\n';
      }

      output += '---\n\n';
    }

    output += `\n**Tip:** Use \`get_example\` tool with specific topics to get code examples from these pages.\n`;

    return output;
  }

  /**
   * Close database connection
   */
  close() {
    this.store.close();
  }
}
