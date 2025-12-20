/**
 * Search Utilities - Intelligent query processing for Minecraft modding documentation
 * Handles tokenization, synonyms, query expansion, and relevance scoring
 */

/**
 * Common English stopwords to filter out
 */
const STOPWORDS = new Set([
  'how',
  'to',
  'in',
  'a',
  'an',
  'the',
  'for',
  'of',
  'with',
  'on',
  'at',
  'by',
  'from',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'it',
  'that',
  'this',
  'these',
  'those',
  'can',
  'do',
  'does',
  'did',
  'will',
  'would',
  'should',
  'could',
  'may',
  'might',
  'must',
]);

/**
 * High-frequency domain terms that should have lower weight
 */
const COMMON_TERMS = new Set([
  'fabric',
  'neoforge',
  'minecraft',
  'mod',
  'loader',
  'java',
  'api',
  'version',
  'game',
  'server',
  'client',
]);

/**
 * Minecraft modding domain-specific synonyms and related terms
 */
const MINECRAFT_SYNONYMS: Record<string, string[]> = {
  // Registration patterns
  register: [
    'registration',
    'registering',
    'create',
    'add',
    'define',
    'declare',
    'init',
    'initialize',
  ],
  item: ['items', 'itemstack', 'tool', 'weapon', 'armor'],
  block: ['blocks', 'blockstate', 'tile'],
  entity: ['entities', 'mob', 'creature', 'living'],

  // Common actions
  create: ['make', 'build', 'generate', 'new', 'add', 'register'],
  custom: ['custom', 'modded', 'new', 'own'],
  add: ['adding', 'insert', 'include', 'register', 'create'],

  // Technical terms
  mixin: ['mixins', 'injection', 'inject', 'hook', 'patch'],
  event: ['events', 'listener', 'handler', 'callback', 'subscribe'],
  network: ['networking', 'packet', 'packets', 'sync', 'synchronize', 's2c', 'c2s'],
  render: ['rendering', 'renderer', 'draw', 'display', 'model', 'texture'],
  data: ['datagen', 'data-generation', 'datapack', 'json', 'recipe', 'loot'],

  // Fabric-specific
  fabric: ['fabricmc', 'fabric-api', 'fapi'],
  entrypoint: ['entrypoints', 'initializer', 'mod-initializer', 'main', 'client', 'server'],
  registry: ['registries', 'registered', 'identifier', 'id'],

  // Block types
  blockentity: ['block-entity', 'tile-entity', 'tileentity', 'be'],
  container: ['inventory', 'chest', 'storage', 'gui', 'screen', 'menu'],

  // Features
  recipe: ['recipes', 'crafting', 'smelting', 'cooking'],
  loot: ['loottable', 'loot-table', 'drops', 'drop'],
  tag: ['tags', 'tagging', 'itemtag', 'blocktag'],
  sound: ['sounds', 'audio', 'music', 'sfx'],
  particle: ['particles', 'effect', 'effects', 'fx'],

  // Commands
  command: ['commands', 'cmd', 'brigadier', 'argument'],
  keybind: ['keybinding', 'keybinds', 'key', 'hotkey', 'shortcut', 'input'],

  // World
  world: ['level', 'dimension', 'worldgen', 'generation', 'biome'],
  structure: ['structures', 'building', 'feature', 'worldgen'],
};

/**
 * Common Minecraft class/method patterns to help with code search
 */
const CODE_PATTERNS: Record<string, string[]> = {
  register: ['Registry.register', 'REGISTRY', 'Registries', 'RegistryKey'],
  item: ['Item', 'ItemStack', 'Item.Settings', 'FabricItemSettings'],
  block: ['Block', 'BlockState', 'Block.Settings', 'FabricBlockSettings'],
  entity: ['Entity', 'LivingEntity', 'EntityType', 'FabricEntityTypeBuilder'],
  blockentity: ['BlockEntity', 'BlockEntityType', 'FabricBlockEntityTypeBuilder'],
  mixin: ['@Mixin', '@Inject', '@Redirect', '@ModifyVariable', 'CallbackInfo'],
  event: ['Event', 'Callback', 'register()', 'ServerLifecycleEvents', 'ClientLifecycleEvents'],
  network: ['PacketByteBuf', 'ServerPlayNetworking', 'ClientPlayNetworking', 'PayloadTypeRegistry'],
  recipe: ['Recipe', 'RecipeSerializer', 'RecipeType', 'Ingredient'],
  command: ['CommandRegistrationCallback', 'LiteralArgumentBuilder', 'RequiredArgumentBuilder'],
  keybind: ['KeyBinding', 'KeyBindingHelper', 'GLFW'],
  screen: ['Screen', 'HandledScreen', 'ScreenHandler', 'ContainerScreen'],
  render: ['Renderer', 'RenderLayer', 'VertexConsumer', 'MatrixStack', 'DrawContext'],
};

export interface TokenizedQuery {
  original: string;
  tokens: string[];
  expandedTokens: string[];
  ftsQuery: string;
  likePatterns: string[];
  codePatterns: string[];
}

/**
 * Tokenize and preprocess a search query
 */
export function tokenizeQuery(query: string): TokenizedQuery {
  const original = query.trim();

  // Tokenize: split on whitespace and common separators
  const tokens = original
    .toLowerCase()
    .split(/[\s\-_.,;:!?()[\]{}'"]+/)
    .filter((t) => t.length > 1)
    .map((t) => t.replace(/[^a-z0-9]/g, ''))
    .filter((t) => !STOPWORDS.has(t)); // Filter stopwords

  // Expand tokens with synonyms
  const expandedSet = new Set<string>();

  for (const token of tokens) {
    expandedSet.add(token);

    // Add direct synonyms
    if (MINECRAFT_SYNONYMS[token]) {
      for (const syn of MINECRAFT_SYNONYMS[token]) {
        expandedSet.add(syn);
      }
    }

    // Check if token is a synonym of something else
    for (const [key, synonyms] of Object.entries(MINECRAFT_SYNONYMS)) {
      if (synonyms.includes(token)) {
        expandedSet.add(key);
        for (const syn of synonyms) {
          expandedSet.add(syn);
        }
      }
    }
  }

  const expandedTokens = Array.from(expandedSet);

  // Build FTS5 query with OR logic
  const ftsQuery = buildFtsQuery(tokens, expandedTokens);

  // Build LIKE patterns for fallback
  const likePatterns = buildLikePatterns(tokens);

  // Get relevant code patterns
  const codePatterns = getCodePatterns(tokens);

  return {
    original,
    tokens,
    expandedTokens,
    ftsQuery,
    likePatterns,
    codePatterns,
  };
}

/**
 * Build an FTS5 query with proper syntax
 * Uses OR for expanded terms, with original terms boosted
 */
function buildFtsQuery(tokens: string[], expandedTokens: string[]): string {
  if (tokens.length === 0) return '';

  // Simple approach: use OR between all expanded tokens
  // FTS5 will handle ranking based on term frequency
  const uniqueTerms = Array.from(new Set([...tokens, ...expandedTokens]));

  // Filter out very short terms and escape special characters
  const validTerms = uniqueTerms
    .filter((t) => t.length > 2)
    .map((t) => t.replace(/['"]/g, ''))
    .filter((t) => t.length > 0);

  if (validTerms.length === 0) {
    // Fallback: use original tokens even if short
    return tokens.map((t) => `"${t}"`).join(' OR ');
  }

  // Build query: original tokens get quoted (phrase-like), expanded get OR'd
  const parts: string[] = [];

  // Add original query as a phrase attempt (high relevance if matches)
  if (tokens.length > 1) {
    parts.push(`"${tokens.join(' ')}"`);
  }

  // Add individual tokens
  // Use AND for the first few important tokens to ensure relevance
  // But fallback to OR if we have many tokens to avoid zero results
  if (validTerms.length <= 3) {
    // For short queries, try to match ALL terms
    parts.push(validTerms.join(' AND '));
  } else {
    // For longer queries, use OR but rely on ranking
    parts.push(validTerms.join(' OR '));
  }

  return parts.join(' OR ');
}

/**
 * Build LIKE patterns for SQL fallback search
 */
function buildLikePatterns(tokens: string[]): string[] {
  const patterns: string[] = [];

  // Full phrase pattern
  if (tokens.length > 0) {
    patterns.push(`%${tokens.join('%')}%`);
  }

  // Individual token patterns
  for (const token of tokens) {
    if (token.length > 2) {
      patterns.push(`%${token}%`);
    }
  }

  return patterns;
}

/**
 * Get relevant code patterns based on query tokens
 */
function getCodePatterns(tokens: string[]): string[] {
  const patterns: string[] = [];

  for (const token of tokens) {
    if (CODE_PATTERNS[token]) {
      patterns.push(...CODE_PATTERNS[token]);
    }

    // Check synonyms too
    for (const [key, synonyms] of Object.entries(MINECRAFT_SYNONYMS)) {
      if (synonyms.includes(token) && CODE_PATTERNS[key]) {
        patterns.push(...CODE_PATTERNS[key]);
      }
    }
  }

  return Array.from(new Set(patterns));
}

export interface ScoredResult<T> {
  item: T;
  score: number;
  matchReasons: string[];
}

/**
 * Calculate relevance score for a search result
 */
export function calculateRelevanceScore(
  item: {
    title?: string;
    content?: string;
    section_heading?: string | null;
    section_content?: string;
    code?: string;
    caption?: string | null;
    category?: string;
    url?: string;
  },
  query: TokenizedQuery
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  const titleLower = (item.title || '').toLowerCase();
  const headingLower = (item.section_heading || '').toLowerCase();
  const contentLower = (item.content || item.section_content || '').toLowerCase();
  const codeLower = (item.code || '').toLowerCase();
  const captionLower = (item.caption || '').toLowerCase();
  const categoryLower = (item.category || '').toLowerCase();
  const urlLower = (item.url || '').toLowerCase();

  // Exact phrase match (highest score)
  const originalLower = query.original.toLowerCase();
  if (titleLower.includes(originalLower)) {
    score += 100;
    reasons.push('exact phrase in title');
  }
  if (headingLower.includes(originalLower)) {
    score += 80;
    reasons.push('exact phrase in heading');
  }
  if (captionLower.includes(originalLower)) {
    score += 70;
    reasons.push('exact phrase in caption');
  }

  // Token matches in different fields
  for (const token of query.tokens) {
    if (token.length < 2) continue;

    // Determine weight based on term frequency
    const isCommon = COMMON_TERMS.has(token);
    const weightMultiplier = isCommon ? 0.1 : 1.0;

    // Title matches (high value)
    if (titleLower.includes(token)) {
      score += 20 * weightMultiplier;
      if (!reasons.includes('token in title')) reasons.push('token in title');
    }

    // Heading matches (high value)
    if (headingLower.includes(token)) {
      score += 18 * weightMultiplier;
      if (!reasons.includes('token in heading')) reasons.push('token in heading');
    }

    // Caption matches
    if (captionLower.includes(token)) {
      score += 15 * weightMultiplier;
      if (!reasons.includes('token in caption')) reasons.push('token in caption');
    }

    // URL/path matches (indicates topic relevance)
    if (urlLower.includes(token)) {
      score += 12 * weightMultiplier;
      if (!reasons.includes('token in URL')) reasons.push('token in URL');
    }

    // Category matches
    if (categoryLower.includes(token)) {
      score += 10 * weightMultiplier;
      if (!reasons.includes('token in category')) reasons.push('token in category');
    }

    // Content matches
    if (contentLower.includes(token)) {
      score += 5 * weightMultiplier;
      if (!reasons.includes('token in content')) reasons.push('token in content');
    }
  }

  // Code pattern matches
  for (const pattern of query.codePatterns) {
    if (codeLower.includes(pattern.toLowerCase())) {
      score += 25;
      if (!reasons.includes('code pattern match')) reasons.push('code pattern match');
    }
  }

  // Expanded token matches (lower weight)
  for (const token of query.expandedTokens) {
    if (query.tokens.includes(token)) continue; // Skip original tokens

    if (titleLower.includes(token) || headingLower.includes(token)) {
      score += 8;
      if (!reasons.includes('synonym match')) reasons.push('synonym match');
    }
  }

  // Boost for having code
  if (item.code && item.code.length > 50) {
    score += 10;
    reasons.push('has substantial code');
  }

  return { score, reasons };
}

/**
 * Deduplicate and rank results
 */
export function deduplicateAndRank<
  T extends { code?: string; url?: string; section_heading?: string | null },
>(results: ScoredResult<T>[], limit: number): ScoredResult<T>[] {
  // Sort by score descending
  const sorted = [...results].sort((a, b) => b.score - a.score);

  // Deduplicate by code content (or URL + heading if no code)
  const seen = new Set<string>();
  const deduplicated: ScoredResult<T>[] = [];

  for (const result of sorted) {
    // Create a dedup key
    let key: string;
    if (result.item.code) {
      // Use first 200 chars of code as key
      key = result.item.code.substring(0, 200).replace(/\s+/g, ' ');
    } else {
      key = `${result.item.url || ''}::${result.item.section_heading || ''}`;
    }

    if (!seen.has(key)) {
      seen.add(key);
      deduplicated.push(result);
    }

    if (deduplicated.length >= limit) break;
  }

  return deduplicated;
}

/**
 * Normalize a score to 0-100 range
 */
export function normalizeScore(score: number, maxPossible: number = 200): number {
  return Math.min(100, Math.round((score / maxPossible) * 100));
}
