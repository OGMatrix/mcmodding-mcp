/**
 * Concept Service - Intelligent concept explanation using hybrid search
 * Provides comprehensive explanations of Minecraft modding concepts
 * by aggregating information from multiple sources using FTS + semantic search
 */

import { DocumentStore } from '../indexer/store.js';
import { EmbeddingGenerator } from '../indexer/embeddings.js';
import { tokenizeQuery } from './search-utils.js';
import path from 'path';

/**
 * Concept explanation result
 */
export interface ConceptExplanation {
  concept: string;
  summary: string;
  details: string;
  keyPoints: string[];
  codeExamples: Array<{
    language: string;
    code: string;
    caption?: string;
    context: string;
    sourceUrl: string;
  }>;
  relatedConcepts: string[];
  resources: Array<{
    title: string;
    url: string;
    relevance: number;
  }>;
  metadata: {
    sourcesUsed: number;
    hasEmbeddings: boolean;
    searchStrategy: string;
  };
}

/**
 * Internal chunk result with scoring
 */
interface ScoredChunk {
  id: string;
  content: string;
  sectionHeading: string | null;
  documentTitle: string;
  documentUrl: string;
  category: string;
  score: number;
  hasCode: boolean;
}

/**
 * Known Minecraft modding concepts with aliases and descriptions
 */
const KNOWN_CONCEPTS: Record<string, { aliases: string[]; category: string }> = {
  mixin: {
    aliases: ['mixins', 'injection', 'inject', '@mixin', '@inject', 'bytecode modification'],
    category: 'advanced',
  },
  registry: {
    aliases: ['registries', 'registration', 'register', 'identifier', 'registry key'],
    category: 'core',
  },
  entrypoint: {
    aliases: ['entrypoints', 'mod initializer', 'initializer', 'onInitialize', 'main class'],
    category: 'getting-started',
  },
  'fabric.mod.json': {
    aliases: ['mod json', 'mod metadata', 'mod manifest', 'mod config file'],
    category: 'getting-started',
  },
  'sided logic': {
    aliases: ['client side', 'server side', 'logical side', 'physical side', 'sided', 'isClient'],
    category: 'networking',
  },
  networking: {
    aliases: ['packets', 'payload', 'c2s', 's2c', 'sync', 'channel', 'network'],
    category: 'networking',
  },
  blockentity: {
    aliases: ['block entity', 'tile entity', 'tileentity', 'block with data'],
    category: 'blocks',
  },
  item: {
    aliases: ['items', 'itemstack', 'custom item', 'item settings'],
    category: 'items',
  },
  block: {
    aliases: ['blocks', 'block state', 'blockstate', 'custom block'],
    category: 'blocks',
  },
  event: {
    aliases: ['events', 'callback', 'listener', 'handler', 'subscribe'],
    category: 'events',
  },
  recipe: {
    aliases: ['recipes', 'crafting', 'smelting', 'recipe type', 'recipe serializer'],
    category: 'data-generation',
  },
  datagen: {
    aliases: ['data generation', 'data gen', 'generators', 'provider'],
    category: 'data-generation',
  },
  render: {
    aliases: ['rendering', 'renderer', 'draw', 'model', 'texture', 'shader'],
    category: 'rendering',
  },
  screen: {
    aliases: ['gui', 'menu', 'handled screen', 'screen handler', 'container'],
    category: 'rendering',
  },
  command: {
    aliases: ['commands', 'brigadier', 'argument', 'command registration'],
    category: 'commands',
  },
  tag: {
    aliases: ['tags', 'item tag', 'block tag', 'tagging'],
    category: 'data-generation',
  },
  loot: {
    aliases: ['loot table', 'loottable', 'drops', 'loot pool'],
    category: 'data-generation',
  },
  sound: {
    aliases: ['sounds', 'audio', 'sound event', 'custom sound'],
    category: 'sounds',
  },
  keybind: {
    aliases: ['keybinding', 'key bind', 'hotkey', 'input', 'key mapping'],
    category: 'rendering',
  },
  entity: {
    aliases: ['entities', 'mob', 'creature', 'living entity', 'custom entity'],
    category: 'entities',
  },
  world: {
    aliases: ['worldgen', 'world generation', 'dimension', 'biome', 'feature'],
    category: 'world',
  },
};

/**
 * Service for explaining Minecraft modding concepts
 */
export class ConceptService {
  private store: DocumentStore;
  private embeddingGen: EmbeddingGenerator | null = null;
  private embeddingsAvailable = false;
  private initialized = false;

  constructor(dbPath?: string) {
    const finalPath =
      dbPath || process.env.DB_PATH || path.join(process.cwd(), 'data', 'mcmodding-docs.db');
    console.error(`[ConceptService] Using database at: ${finalPath}`);
    this.store = new DocumentStore(finalPath);
  }

  /**
   * Initialize the service (with optimized embedding support)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Check if embeddings are available
    const embCount = this.store.getEmbeddingCount();
    if (embCount > 0) {
      console.error(
        `[ConceptService] Found ${embCount} embeddings, enabling optimized semantic search`
      );
      try {
        this.embeddingGen = new EmbeddingGenerator();
        await this.embeddingGen.initialize();
        this.embeddingsAvailable = true;
        console.error('[ConceptService] Optimized semantic search enabled (batch processing)');
      } catch (error) {
        console.error('[ConceptService] Failed to initialize embeddings:', error);
        this.embeddingsAvailable = false;
      }
    } else {
      console.error('[ConceptService] No embeddings found, using FTS-only search');
    }

    this.initialized = true;
  }

  /**
   * Explain a concept comprehensively
   */
  async explainConcept(concept: string): Promise<ConceptExplanation> {
    await this.initialize();

    const normalizedConcept = concept.toLowerCase().trim();
    console.error(`[ConceptService] Explaining concept: "${normalizedConcept}"`);

    // Expand concept with known aliases
    const expandedTerms = this.expandConcept(normalizedConcept);
    console.error(`[ConceptService] Expanded terms: ${expandedTerms.join(', ')}`);

    // Perform hybrid search
    const scoredChunks = await this.hybridSearch(expandedTerms, normalizedConcept);
    console.error(`[ConceptService] Found ${scoredChunks.length} relevant chunks`);

    // Aggregate content from chunks
    const aggregatedContent = this.aggregateContent(scoredChunks);

    // Extract key points
    const keyPoints = this.extractKeyPoints(scoredChunks, normalizedConcept);

    // Find code examples
    const codeExamples = this.findCodeExamples(normalizedConcept, expandedTerms);

    // Extract related concepts
    const relatedConcepts = this.extractRelatedConcepts(scoredChunks, normalizedConcept);

    // Build resources list
    const resources = this.buildResourcesList(scoredChunks);

    // Generate summary and details
    const summary = this.generateSummary(aggregatedContent, normalizedConcept, keyPoints);
    const details = this.generateDetails(aggregatedContent, scoredChunks);

    return {
      concept: normalizedConcept,
      summary,
      details,
      keyPoints,
      codeExamples,
      relatedConcepts,
      resources,
      metadata: {
        sourcesUsed: new Set(scoredChunks.map((c) => c.documentUrl)).size,
        hasEmbeddings: this.embeddingsAvailable,
        searchStrategy: this.embeddingsAvailable
          ? 'hybrid (FTS + optimized semantic)'
          : 'FTS + section search',
      },
    };
  }

  /**
   * Expand concept with known aliases and synonyms
   */
  private expandConcept(concept: string): string[] {
    const terms = new Set<string>([concept]);

    // Check known concepts
    for (const [key, info] of Object.entries(KNOWN_CONCEPTS)) {
      if (key === concept || info.aliases.some((a) => concept.includes(a) || a.includes(concept))) {
        terms.add(key);
        info.aliases.forEach((a) => terms.add(a));
      }
    }

    // Also check if concept matches any alias
    for (const [key, info] of Object.entries(KNOWN_CONCEPTS)) {
      if (info.aliases.includes(concept)) {
        terms.add(key);
        info.aliases.forEach((a) => terms.add(a));
      }
    }

    // Tokenize and expand using search-utils
    const tokenized = tokenizeQuery(concept);
    tokenized.expandedTokens.forEach((t) => terms.add(t));

    return Array.from(terms);
  }

  /**
   * Perform hybrid search combining FTS and semantic search
   */
  private async hybridSearch(terms: string[], originalConcept: string): Promise<ScoredChunk[]> {
    const allChunks = new Map<string, ScoredChunk>();

    // Strategy 1: FTS search on chunks
    const ftsQuery = terms.filter((t) => t.length > 2).join(' OR ');
    const ftsResults = this.store.searchChunksAdvanced(
      ftsQuery,
      terms.map((t) => `%${t}%`),
      { hasCode: false, limit: 50 }
    );

    for (const chunk of ftsResults) {
      const key = chunk.id;
      allChunks.set(key, {
        id: chunk.id,
        content: chunk.content,
        sectionHeading: chunk.section_heading,
        documentTitle: chunk.title,
        documentUrl: chunk.url,
        category: chunk.category,
        score: 50, // Base FTS score
        hasCode: chunk.has_code === 1,
      });
    }

    // Strategy 2: Section search
    const sectionResults = this.store.searchSections(originalConcept, { limit: 30 });
    for (const section of sectionResults) {
      const key = `section-${section.id}`;
      if (!allChunks.has(key)) {
        allChunks.set(key, {
          id: key,
          content: section.content,
          sectionHeading: section.heading,
          documentTitle: section.document_title,
          documentUrl: section.document_url,
          category: section.category,
          score: 40,
          hasCode: false,
        });
      }
    }

    // Strategy 3: Optimized semantic search (batch-based processing)
    if (this.embeddingsAvailable && this.embeddingGen) {
      try {
        const queryEmbedding = await this.embeddingGen.generateEmbedding(
          `Explain ${originalConcept} in Minecraft modding with Fabric`
        );

        // Process embeddings in batches to avoid memory issues
        const batchSize = 500;
        const totalEmbeddings = this.store.getEmbeddingCount();
        const topK = 30;
        const topMatches: Array<{ chunkId: string; similarity: number }> = [];

        for (let offset = 0; offset < totalEmbeddings; offset += batchSize) {
          const batchEmbeddings = this.store.getEmbeddingsBatch(batchSize, offset);

          // Calculate similarity for this batch
          for (const emb of batchEmbeddings) {
            const similarity = this.cosineSimilarity(queryEmbedding, emb.embedding);
            topMatches.push({ chunkId: emb.chunkId, similarity });
          }

          // Keep only top-K to limit memory usage
          if (topMatches.length > topK * 2) {
            topMatches.sort((a, b) => b.similarity - a.similarity);
            topMatches.length = topK * 2;
          }
        }

        // Sort and get final top-K results
        topMatches.sort((a, b) => b.similarity - a.similarity);
        const finalMatches = topMatches.slice(0, topK);

        // Boost scores for semantic matches
        for (const match of finalMatches) {
          const existing = allChunks.get(match.chunkId);
          if (existing) {
            existing.score += match.similarity * 60;
          }
        }
      } catch (error) {
        console.error('[ConceptService] Semantic search failed:', error);
      }
    }

    // Apply relevance boosting based on content
    for (const chunk of allChunks.values()) {
      const contentLower = chunk.content.toLowerCase();
      const headingLower = (chunk.sectionHeading || '').toLowerCase();

      // Boost for exact concept mention
      if (contentLower.includes(originalConcept)) {
        chunk.score += 30;
      }
      if (headingLower.includes(originalConcept)) {
        chunk.score += 40;
      }

      // Boost for term frequency
      for (const term of terms) {
        if (term.length < 3) continue;
        const termLower = term.toLowerCase();
        const count = (contentLower.match(new RegExp(termLower, 'g')) || []).length;
        chunk.score += Math.min(count * 5, 25);
      }

      // Boost for having code (practical examples)
      if (chunk.hasCode) {
        chunk.score += 15;
      }
    }

    // Sort by score and return top results
    const sorted = Array.from(allChunks.values()).sort((a, b) => b.score - a.score);
    return sorted.slice(0, 30);
  }

  /**
   * Aggregate content from scored chunks
   */
  private aggregateContent(chunks: ScoredChunk[]): string {
    const seenContent = new Set<string>();
    const contentParts: string[] = [];

    for (const chunk of chunks.slice(0, 15)) {
      // Deduplicate by content hash
      const contentKey = chunk.content.substring(0, 100);
      if (seenContent.has(contentKey)) continue;
      seenContent.add(contentKey);

      // Clean and add content
      const cleaned = this.cleanContent(chunk.content);
      if (cleaned.length > 50) {
        contentParts.push(cleaned);
      }
    }

    return contentParts.join('\n\n');
  }

  /**
   * Clean content by removing noise
   */
  private cleanContent(content: string): string {
    return content
      .replace(/[\u{1F1E6}-\u{1F1FF}]{2}/gu, '') // Remove flag emojis
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+/g, ' ')
      .trim();
  }

  /**
   * Extract key points from chunks
   */
  private extractKeyPoints(chunks: ScoredChunk[], concept: string): string[] {
    const keyPoints: string[] = [];
    const seenPoints = new Set<string>();

    for (const chunk of chunks.slice(0, 10)) {
      // Extract sentences that mention the concept
      const sentences = chunk.content.split(/[.!?]+/);
      for (const sentence of sentences) {
        const trimmed = sentence.trim();
        if (trimmed.length < 20 || trimmed.length > 200) continue;

        const lowerSentence = trimmed.toLowerCase();
        if (lowerSentence.includes(concept) || this.containsKeyTerms(lowerSentence, concept)) {
          // Normalize for deduplication
          const key = trimmed.substring(0, 50).toLowerCase();
          if (!seenPoints.has(key)) {
            seenPoints.add(key);
            keyPoints.push(trimmed);
          }
        }
      }

      if (keyPoints.length >= 8) break;
    }

    return keyPoints.slice(0, 8);
  }

  /**
   * Check if text contains key terms related to concept
   */
  private containsKeyTerms(text: string, concept: string): boolean {
    const knownInfo = KNOWN_CONCEPTS[concept];
    if (!knownInfo) return false;

    return knownInfo.aliases.some((alias) => text.includes(alias.toLowerCase()));
  }

  /**
   * Find code examples for the concept
   */
  private findCodeExamples(concept: string, terms: string[]): ConceptExplanation['codeExamples'] {
    const examples: ConceptExplanation['codeExamples'] = [];
    const seenCode = new Set<string>();

    // Search code blocks by patterns
    const codePatterns = this.getCodePatterns(concept, terms);
    const codeResults = this.store.searchCodeBlocksByPatterns(codePatterns, {
      language: 'java',
      limit: 15,
    });

    for (const block of codeResults) {
      // Deduplicate by code content
      const codeKey = block.code.substring(0, 100);
      if (seenCode.has(codeKey)) continue;
      seenCode.add(codeKey);

      // Skip very short or very long code
      if (block.code.length < 30 || block.code.length > 2000) continue;

      examples.push({
        language: block.language,
        code: block.code,
        caption: block.caption || undefined,
        context: block.section_heading || block.document_title,
        sourceUrl: block.document_url,
      });

      if (examples.length >= 5) break;
    }

    // Also search in chunks with code
    if (examples.length < 3) {
      const codeChunks = this.store.searchChunksAdvanced(
        terms.filter((t) => t.length > 2).join(' OR '),
        terms.map((t) => `%${t}%`),
        { hasCode: true, limit: 20 }
      );

      for (const chunk of codeChunks) {
        if (examples.length >= 5) break;

        // Extract code from chunk content
        const codeMatch = chunk.content.match(/```[\s\S]*?```|`[^`]+`/);
        if (codeMatch) {
          const code = codeMatch[0].replace(/```\w*\n?|```|`/g, '').trim();
          const codeKey = code.substring(0, 100);
          if (!seenCode.has(codeKey) && code.length > 30) {
            seenCode.add(codeKey);
            examples.push({
              language: chunk.code_language || 'java',
              code,
              context: chunk.section_heading || chunk.title,
              sourceUrl: chunk.url,
            });
          }
        }
      }
    }

    return examples;
  }

  /**
   * Get code patterns for a concept
   */
  private getCodePatterns(concept: string, terms: string[]): string[] {
    const patterns: string[] = [];

    // Add direct patterns
    for (const term of terms) {
      if (term.length > 3) {
        patterns.push(term);
        // Add PascalCase version
        patterns.push(term.charAt(0).toUpperCase() + term.slice(1));
      }
    }

    // Add known code patterns
    const conceptPatterns: Record<string, string[]> = {
      mixin: ['@Mixin', '@Inject', '@Redirect', 'CallbackInfo', '@ModifyVariable'],
      registry: ['Registry.register', 'Registries.', 'RegistryKey', 'Identifier'],
      item: ['Item', 'ItemStack', 'Item.Settings', 'FabricItemSettings'],
      block: ['Block', 'BlockState', 'Block.Settings', 'FabricBlockSettings'],
      entity: ['Entity', 'EntityType', 'LivingEntity', 'FabricEntityTypeBuilder'],
      blockentity: ['BlockEntity', 'BlockEntityType', 'FabricBlockEntityTypeBuilder'],
      network: [
        'PacketByteBuf',
        'ServerPlayNetworking',
        'ClientPlayNetworking',
        'PayloadTypeRegistry',
      ],
      event: ['Event', 'Callback', 'ServerLifecycleEvents', 'ClientLifecycleEvents'],
      command: ['CommandRegistrationCallback', 'LiteralArgumentBuilder', 'RequiredArgumentBuilder'],
      recipe: ['Recipe', 'RecipeSerializer', 'RecipeType', 'Ingredient'],
      screen: ['Screen', 'HandledScreen', 'ScreenHandler', 'DrawContext'],
      render: ['Renderer', 'RenderLayer', 'VertexConsumer', 'MatrixStack'],
      sound: ['SoundEvent', 'SoundEvents', 'playSound'],
      keybind: ['KeyBinding', 'KeyBindingHelper', 'GLFW'],
    };

    const knownPatterns = conceptPatterns[concept];
    if (knownPatterns) {
      patterns.push(...knownPatterns);
    }

    return [...new Set(patterns)];
  }

  /**
   * Extract related concepts from chunks
   */
  private extractRelatedConcepts(chunks: ScoredChunk[], excludeConcept: string): string[] {
    const related = new Map<string, number>();

    for (const chunk of chunks) {
      const contentLower = chunk.content.toLowerCase();

      for (const [concept, info] of Object.entries(KNOWN_CONCEPTS)) {
        if (concept === excludeConcept) continue;

        // Check if concept or aliases are mentioned
        if (contentLower.includes(concept)) {
          related.set(concept, (related.get(concept) || 0) + 3);
        }

        for (const alias of info.aliases) {
          if (contentLower.includes(alias.toLowerCase())) {
            related.set(concept, (related.get(concept) || 0) + 1);
          }
        }
      }
    }

    // Sort by frequency and return top related concepts
    return Array.from(related.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([concept]) => concept);
  }

  /**
   * Build resources list from chunks
   */
  private buildResourcesList(chunks: ScoredChunk[]): ConceptExplanation['resources'] {
    const resourceMap = new Map<string, { title: string; url: string; score: number }>();

    for (const chunk of chunks) {
      const existing = resourceMap.get(chunk.documentUrl);
      if (existing) {
        existing.score = Math.max(existing.score, chunk.score);
      } else {
        resourceMap.set(chunk.documentUrl, {
          title: chunk.documentTitle,
          url: chunk.documentUrl,
          score: chunk.score,
        });
      }
    }

    return Array.from(resourceMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((r) => ({
        title: r.title,
        url: r.url,
        relevance: Math.round((r.score / 100) * 100) / 100,
      }));
  }

  /**
   * Generate summary from aggregated content
   */
  private generateSummary(content: string, concept: string, keyPoints: string[]): string {
    // Find the most relevant introductory sentence
    const sentences = content.split(/[.!?]+/).filter((s) => s.trim().length > 20);

    for (const sentence of sentences) {
      const lower = sentence.toLowerCase();
      if (
        lower.includes(concept) &&
        (lower.includes('is') ||
          lower.includes('are') ||
          lower.includes('allows') ||
          lower.includes('provides'))
      ) {
        return sentence.trim() + '.';
      }
    }

    // Fallback: use first key point or first sentence
    if (keyPoints.length > 0 && keyPoints[0]) {
      return keyPoints[0] + (keyPoints[0].endsWith('.') ? '' : '.');
    }

    if (sentences.length > 0 && sentences[0]) {
      return sentences[0].trim() + '.';
    }

    return `${concept} is a concept in Minecraft modding with Fabric.`;
  }

  /**
   * Generate detailed explanation
   */
  private generateDetails(_content: string, chunks: ScoredChunk[]): string {
    const parts: string[] = [];
    const seenContent = new Set<string>();

    // Group by section heading for better organization
    const sectionMap = new Map<string, string[]>();

    for (const chunk of chunks.slice(0, 12)) {
      const heading = chunk.sectionHeading || 'Overview';
      const contentKey = chunk.content.substring(0, 80);

      if (seenContent.has(contentKey)) continue;
      seenContent.add(contentKey);

      const cleaned = this.cleanContent(chunk.content);
      if (cleaned.length > 50) {
        let sectionContents = sectionMap.get(heading);
        if (!sectionContents) {
          sectionContents = [];
          sectionMap.set(heading, sectionContents);
        }
        sectionContents.push(cleaned);
      }
    }

    // Build organized details
    for (const [heading, contents] of sectionMap) {
      if (contents.length > 0) {
        parts.push(`**${heading}:**\n${contents.slice(0, 2).join('\n\n')}`);
      }
    }

    return parts.slice(0, 5).join('\n\n---\n\n');
  }

  /**
   * Format explanation for AI consumption
   */
  formatForAI(explanation: ConceptExplanation): string {
    let output = `# Understanding: ${explanation.concept}\n\n`;

    // Summary
    output += `## Summary\n${explanation.summary}\n\n`;

    // Key Points
    if (explanation.keyPoints.length > 0) {
      output += `## Key Points\n`;
      for (const point of explanation.keyPoints) {
        output += `- ${point}\n`;
      }
      output += '\n';
    }

    // Detailed Explanation
    if (explanation.details) {
      output += `## Detailed Explanation\n${explanation.details}\n\n`;
    }

    // Code Examples
    if (explanation.codeExamples.length > 0) {
      output += `## Code Examples\n\n`;
      for (let i = 0; i < explanation.codeExamples.length; i++) {
        const example = explanation.codeExamples[i];
        if (!example) continue;
        output += `### Example ${i + 1}: ${example.context}\n`;
        if (example.caption) {
          output += `*${example.caption}*\n`;
        }
        output += `\`\`\`${example.language}\n${example.code}\n\`\`\`\n`;
        output += `Source: ${example.sourceUrl}\n\n`;
      }
    }

    // Related Concepts
    if (explanation.relatedConcepts.length > 0) {
      output += `## Related Concepts\n`;
      output += explanation.relatedConcepts.map((c) => `- ${c}`).join('\n');
      output += '\n\n';
    }

    // Resources
    if (explanation.resources.length > 0) {
      output += `## Documentation Resources\n`;
      for (const resource of explanation.resources.slice(0, 6)) {
        output += `- [${resource.title}](${resource.url})\n`;
      }
      output += '\n';
    }

    // Metadata
    output += `---\n`;
    output += `*Sources: ${explanation.metadata.sourcesUsed} documents | `;
    output += `Search: ${explanation.metadata.searchStrategy}*\n`;

    return output;
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;

    for (let i = 0; i < a.length; i++) {
      const aVal = a[i] ?? 0;
      const bVal = b[i] ?? 0;
      dotProduct += aVal * bVal;
      magnitudeA += aVal * aVal;
      magnitudeB += bVal * bVal;
    }

    magnitudeA = Math.sqrt(magnitudeA);
    magnitudeB = Math.sqrt(magnitudeB);

    if (magnitudeA === 0 || magnitudeB === 0) return 0;
    return dotProduct / (magnitudeA * magnitudeB);
  }

  /**
   * Close resources
   */
  close() {
    this.store.close();
  }
}
