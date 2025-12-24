/**
 * Mappings Service - Query Minecraft class/method/field mappings from Parchment data
 * Provides access to deobfuscated names, parameter names, and Javadocs for AI-assisted modding
 *
 * Features:
 * - Semantic search with CamelCase tokenization
 * - Fuzzy matching with Levenshtein distance
 * - Multi-token query support ("send message" → sendMessage)
 * - Word boundary aware scoring
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

// ═══════════════════════════════════════════════════════════════════════════════
// SEARCH UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Common abbreviations used in Minecraft modding
 * Maps abbreviations to their full forms for expansion
 */
const ABBREVIATION_MAP: Record<string, string[]> = {
  // Common abbreviations
  msg: ['message'],
  btn: ['button'],
  inv: ['inventory'],
  pos: ['position'],
  vel: ['velocity'],
  dir: ['direction'],
  cfg: ['config', 'configuration'],
  pkt: ['packet'],
  tex: ['texture'],
  gui: ['gui', 'screen', 'interface'],
  nbt: ['nbt', 'tag', 'compound'],
  mc: ['minecraft'],
  bb: ['bounding', 'boundingbox'],
  aabb: ['aabb', 'boundingbox'],
  ai: ['ai', 'artificial'],
  dmg: ['damage'],
  hp: ['health'],
  xp: ['experience'],
  lvl: ['level'],
  idx: ['index'],
  len: ['length'],
  cnt: ['count'],
  num: ['number'],
  str: ['string'],
  obj: ['object'],
  arr: ['array'],
  vec: ['vector'],
  mat: ['matrix', 'material'],
  col: ['color', 'column', 'collision'],
  rot: ['rotation'],
  trans: ['translation', 'transform'],
  ent: ['entity'],
  blk: ['block'],
  itm: ['item'],
  ply: ['player'],
  srv: ['server'],
  cli: ['client'],
  net: ['network'],
  reg: ['register', 'registry'],
  evt: ['event'],
  cb: ['callback'],
  fn: ['function'],
  ctx: ['context'],
  req: ['request'],
  res: ['response', 'result'],
  err: ['error'],
  def: ['default', 'definition'],
  init: ['initialize', 'initial'],
  desc: ['descriptor', 'description'],
  info: ['information'],
  src: ['source'],
  dst: ['destination'],
  tmp: ['temporary'],
  max: ['maximum'],
  min: ['minimum'],
  avg: ['average'],
  rnd: ['random', 'render'],
  gen: ['generate', 'generator'],
  sync: ['synchronized', 'synchronize'],
  async: ['asynchronous'],
};

/**
 * Internal method prefixes that should be deprioritized
 * These are typically GLFW/OpenGL internals or lambda functions
 */
const INTERNAL_PREFIXES = ['_', 'lambda$', 'access$', '$'];

/**
 * Check if a name appears to be an internal/generated method
 */
function isInternalName(name: string): boolean {
  if (!name) return false;
  for (const prefix of INTERNAL_PREFIXES) {
    if (name.startsWith(prefix)) return true;
  }
  // Also check for $ in the middle (lambda methods)
  if (name.includes('$') && !name.endsWith('$')) return true;
  return false;
}

/**
 * Expand abbreviations in a query to include full forms
 */
function expandAbbreviations(tokens: string[]): string[] {
  const expanded: string[] = [];
  for (const token of tokens) {
    expanded.push(token);
    const expansions = ABBREVIATION_MAP[token.toLowerCase()];
    if (expansions) {
      for (const exp of expansions) {
        if (!expanded.includes(exp)) {
          expanded.push(exp);
        }
      }
    }
  }
  return expanded;
}

/**
 * Split a CamelCase or snake_case identifier into tokens
 * Examples:
 *   sendMessage → ["send", "message"]
 *   send_message → ["send", "message"]
 *   XMLParser → ["xml", "parser"]
 *   getHTTPResponse → ["get", "http", "response"]
 */
function tokenizeIdentifier(identifier: string): string[] {
  // Handle empty/null
  if (!identifier) return [];

  // Replace underscores and hyphens with spaces for splitting
  let normalized = identifier.replace(/[_-]/g, ' ');

  // Insert space before uppercase letters that follow lowercase (camelCase)
  // But handle consecutive capitals (acronyms) carefully
  normalized = normalized.replace(/([a-z])([A-Z])/g, '$1 $2');

  // Handle acronyms followed by lowercase (XMLParser → XML Parser)
  normalized = normalized.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');

  // Split on whitespace and filter
  return normalized
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/**
 * Compute Levenshtein distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Create 2D matrix with proper initialization
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = new Array<number>(a.length + 1).fill(0);
  }

  // Initialize first column
  for (let i = 0; i <= b.length; i++) {
    matrix[i]![0] = i;
  }
  // Initialize first row
  for (let j = 0; j <= a.length; j++) {
    matrix[0]![j] = j;
  }

  // Fill matrix
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i]![j] = matrix[i - 1]![j - 1]!;
      } else {
        matrix[i]![j] = Math.min(
          matrix[i - 1]![j - 1]! + 1, // substitution
          matrix[i]![j - 1]! + 1, // insertion
          matrix[i - 1]![j]! + 1 // deletion
        );
      }
    }
  }

  return matrix[b.length]![a.length]!;
}

/**
 * Calculate similarity score between two strings (0-1)
 * Uses Levenshtein distance normalized by length
 */
function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1.0;
  if (a.length === 0 || b.length === 0) return 0.0;

  const distance = levenshteinDistance(a.toLowerCase(), b.toLowerCase());
  const maxLength = Math.max(a.length, b.length);

  return 1 - distance / maxLength;
}

/**
 * Check if a string contains a substring (case-insensitive)
 */
function containsCI(str: string, substr: string): boolean {
  return str.toLowerCase().includes(substr.toLowerCase());
}

/**
 * Tokenize a search query into normalized tokens
 * Handles natural language queries like "send message" or "get player health"
 * Also expands common abbreviations for better matching
 */
function tokenizeQuery(query: string): string[] {
  // First, split on whitespace, underscores, hyphens
  const parts = query.toLowerCase().split(/[\s_-]+/);

  // Expand CamelCase if present
  const tokens: string[] = [];
  for (const part of parts) {
    tokens.push(...tokenizeIdentifier(part));
  }

  // Remove duplicates and very short tokens
  const uniqueTokens = [...new Set(tokens)].filter((t) => t.length >= 2);

  // Expand abbreviations
  return expandAbbreviations(uniqueTokens);
}

/**
 * Calculate semantic match score between query tokens and an identifier
 *
 * Scoring strategy (0-100):
 * - Exact match: 100 points
 * - Starts with query: 85-95 points
 * - All query tokens found exactly: 75-90 points
 * - All query tokens found (partial): 60-75 points
 * - Most tokens matched: 40-60 points
 * - Fuzzy matches: 20-40 points
 *
 * Penalties:
 * - Internal/lambda methods: -20 points
 * - Very long identifiers: -5 points
 *
 * Bonuses:
 * - Shorter identifiers: +5 points
 * - Tokens in order: +5 points
 * - Name starts with first query token: +10 points
 */
function calculateSemanticScore(
  identifier: string,
  queryTokens: string[],
  originalQuery: string
): number {
  if (!identifier || queryTokens.length === 0) return 0;

  const identifierLower = identifier.toLowerCase();
  const originalLower = originalQuery.toLowerCase().replace(/[\s_-]+/g, '');

  // Penalty for internal/generated methods
  const internalPenalty = isInternalName(identifier) ? 25 : 0;

  // Check for exact match (highest priority)
  if (identifierLower === originalLower) {
    return 100 - internalPenalty;
  }

  // Check if identifier starts with the query (joined)
  if (identifierLower.startsWith(originalLower)) {
    const lengthBonus = Math.max(0, 10 - (identifier.length - originalQuery.length));
    return Math.min(95, 85 + lengthBonus) - internalPenalty;
  }

  // Check whole-string fuzzy match for typos (e.g., "setHelth" → "setHealth")
  // This catches cases where the query is a single misspelled token
  const wholeStringSimilarity = stringSimilarity(originalLower, identifierLower);
  if (wholeStringSimilarity >= 0.75) {
    // High similarity to the whole identifier - this is likely a typo
    const fuzzyScore = 50 + wholeStringSimilarity * 40;
    return Math.min(Math.round(fuzzyScore), 90) - internalPenalty;
  }

  // Tokenize the identifier
  const identifierTokens = tokenizeIdentifier(identifier);

  // Track matching quality for each query token
  // Use only the base tokens (not expanded abbreviations) for primary matching
  // but keep abbreviation expansions for secondary matching
  const baseQueryTokens = originalQuery
    .toLowerCase()
    .split(/[\s_-]+/)
    .flatMap((p) => tokenizeIdentifier(p))
    .filter((t) => t.length >= 2);
  const baseTokenSet = new Set(baseQueryTokens);

  let exactMatches = 0;
  let prefixMatches = 0;
  let containsMatches = 0;
  let fuzzyMatches = 0;
  let totalMatchScore = 0;

  // Score each query token
  for (const queryToken of queryTokens) {
    let bestMatch = 0;
    const isBaseToken = baseTokenSet.has(queryToken);
    const tokenWeight = isBaseToken ? 1.0 : 0.6; // Expanded tokens matter less

    for (const idToken of identifierTokens) {
      // Exact token match
      if (idToken === queryToken) {
        bestMatch = Math.max(bestMatch, 1.0);
        break; // Can't do better than exact
      }

      // Token starts with query token (e.g., "msg" matches "message")
      if (idToken.startsWith(queryToken)) {
        const prefixScore = 0.9 - (idToken.length - queryToken.length) * 0.02;
        bestMatch = Math.max(bestMatch, Math.max(0.75, prefixScore));
        continue;
      }

      // Query token starts with id token (e.g., "message" matches "msg")
      if (queryToken.startsWith(idToken) && idToken.length >= 3) {
        const prefixScore = 0.8 - (queryToken.length - idToken.length) * 0.03;
        bestMatch = Math.max(bestMatch, Math.max(0.65, prefixScore));
        continue;
      }

      // Contains match (but not just single letters)
      if (queryToken.length >= 3 && idToken.includes(queryToken)) {
        bestMatch = Math.max(bestMatch, 0.7);
        continue;
      }
      if (idToken.length >= 3 && queryToken.includes(idToken)) {
        bestMatch = Math.max(bestMatch, 0.6);
        continue;
      }

      // Fuzzy match (for typos) - IMPROVED THRESHOLD
      // Allow more lenient matching for longer tokens
      const minLen = Math.min(idToken.length, queryToken.length);
      const fuzzyThreshold = minLen >= 6 ? 0.65 : minLen >= 4 ? 0.7 : 0.75;

      const similarity = stringSimilarity(idToken, queryToken);
      if (similarity >= fuzzyThreshold) {
        // Higher multiplier for fuzzy matches
        const fuzzyScore = similarity * 0.7;
        bestMatch = Math.max(bestMatch, fuzzyScore);
      }
    }

    // Categorize the match
    if (bestMatch >= 0.95) {
      exactMatches++;
    } else if (bestMatch >= 0.75) {
      prefixMatches++;
    } else if (bestMatch >= 0.55) {
      containsMatches++;
    } else if (bestMatch > 0.3) {
      fuzzyMatches++;
    }

    totalMatchScore += bestMatch * tokenWeight;
  }

  // Calculate final score based on match distribution
  let score = 0;
  const totalBaseTokens = baseQueryTokens.length || 1;
  const matchedBase =
    exactMatches + prefixMatches >= totalBaseTokens * 0.8 ? totalBaseTokens : exactMatches;

  // All base tokens matched exactly
  if (matchedBase === totalBaseTokens) {
    score = 75 + (totalMatchScore / queryTokens.length) * 15;

    // Bonus if tokens appear in the correct order
    const joinedQuery = baseQueryTokens.join('');
    if (identifierLower.includes(joinedQuery)) {
      score += 5;
    }

    // Bonus if identifier starts with first query token
    if (identifierTokens[0] === baseQueryTokens[0]) {
      score += 10;
    }
  }
  // Most tokens matched (prefix or exact)
  else if (exactMatches + prefixMatches >= totalBaseTokens * 0.7) {
    score = 55 + (totalMatchScore / queryTokens.length) * 20;
  }
  // Some good matches
  else if (exactMatches + prefixMatches + containsMatches >= totalBaseTokens * 0.5) {
    score = 40 + (totalMatchScore / queryTokens.length) * 20;
  }
  // Fuzzy matches only
  else if (fuzzyMatches > 0 || totalMatchScore > 0.3) {
    score = 20 + (totalMatchScore / queryTokens.length) * 30;
  }

  // Length-based adjustments
  if (identifier.length < 15) {
    score += 5; // Bonus for concise names
  } else if (identifier.length > 40) {
    score -= 5; // Penalty for very long names
  }

  // Also check raw contains (for cases like searching "Player" finding "ServerPlayer")
  if (containsCI(identifier, originalLower) && originalLower.length >= 3) {
    const containsScore = 55 + (originalLower.length / identifier.length) * 20;
    score = Math.max(score, containsScore);
  }

  // Apply internal penalty
  score -= internalPenalty;

  return Math.min(Math.max(Math.round(score), 0), 100);
}

// ═══════════════════════════════════════════════════════════════════════════════
// INTERFACES
// ═══════════════════════════════════════════════════════════════════════════════

export interface MappingClass {
  id: number;
  name: string;
  obfuscatedName: string | null;
  javadoc: string | null;
  packageName: string;
  minecraftVersion: string;
  methodCount: number;
  fieldCount: number;
}

export interface MappingMethod {
  id: number;
  classId: number;
  className: string;
  name: string;
  obfuscatedName: string | null;
  descriptor: string;
  javadoc: string | null;
  minecraftVersion: string;
  parameters: MappingParameter[];
}

export interface MappingField {
  id: number;
  classId: number;
  className: string;
  name: string;
  obfuscatedName: string | null;
  descriptor: string;
  javadoc: string | null;
  minecraftVersion: string;
}

export interface MappingParameter {
  id: number;
  methodId: number;
  index: number;
  name: string;
  javadoc: string | null;
}

export interface MappingSearchOptions {
  query: string;
  type?: 'class' | 'method' | 'field' | 'all';
  minecraftVersion?: string;
  packageFilter?: string;
  includeJavadoc?: boolean;
  limit?: number;
}

export interface MappingSearchResult {
  type: 'class' | 'method' | 'field';
  name: string;
  fullName: string;
  obfuscatedName: string | null;
  descriptor: string | null;
  javadoc: string | null;
  className: string | null;
  packageName: string | null;
  minecraftVersion: string;
  parameters?: MappingParameter[];
  score: number;
}

export interface MappingsStats {
  totalClasses: number;
  totalMethods: number;
  totalFields: number;
  totalParameters: number;
  minecraftVersions: string[];
  topPackages: Array<{ packageName: string; count: number }>;
  documentedMethods: number;
  documentedFields: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SERVICE CLASS
// ═══════════════════════════════════════════════════════════════════════════════

export class MappingsService {
  private db: Database.Database;
  private static dbPath = path.join(process.cwd(), 'data', 'parchment-mappings.db');

  constructor(dbPath?: string) {
    const finalPath = dbPath || MappingsService.dbPath;
    console.error(`[MappingsService] Using database at: ${finalPath}`);
    this.db = new Database(finalPath, { readonly: true });
  }

  /**
   * Check if the mappings database is available
   */
  static isAvailable(): boolean {
    return fs.existsSync(MappingsService.dbPath);
  }

  /**
   * Get database path
   */
  static getDbPath(): string {
    return MappingsService.dbPath;
  }

  /**
   * Get database statistics
   */
  getStats(): MappingsStats {
    const counts = this.db
      .prepare(
        `
        SELECT
          (SELECT COUNT(*) FROM classes) as totalClasses,
          (SELECT COUNT(*) FROM methods) as totalMethods,
          (SELECT COUNT(*) FROM fields) as totalFields,
          (SELECT COUNT(*) FROM parameters) as totalParameters,
          (SELECT COUNT(*) FROM methods WHERE javadoc IS NOT NULL AND javadoc != '') as documentedMethods,
          (SELECT COUNT(*) FROM fields WHERE javadoc IS NOT NULL AND javadoc != '') as documentedFields
      `
      )
      .get() as {
      totalClasses: number;
      totalMethods: number;
      totalFields: number;
      totalParameters: number;
      documentedMethods: number;
      documentedFields: number;
    };

    const versions = this.db
      .prepare(`SELECT DISTINCT minecraft_version FROM classes ORDER BY minecraft_version DESC`)
      .all() as Array<{ minecraft_version: string }>;

    const topPackages = this.db
      .prepare(
        `
        SELECT package_name as packageName, COUNT(*) as count
        FROM classes
        GROUP BY package_name
        ORDER BY count DESC
        LIMIT 10
      `
      )
      .all() as Array<{ packageName: string; count: number }>;

    return {
      ...counts,
      minecraftVersions: versions.map((v) => v.minecraft_version),
      topPackages,
    };
  }

  /**
   * Get all available Minecraft versions in the database
   */
  getMinecraftVersions(): string[] {
    const versions = this.db
      .prepare(`SELECT DISTINCT minecraft_version FROM classes ORDER BY minecraft_version DESC`)
      .all() as Array<{ minecraft_version: string }>;
    return versions.map((v) => v.minecraft_version);
  }

  /**
   * Get the latest Minecraft version in the database
   */
  getLatestVersion(): string | null {
    const result = this.db
      .prepare(
        `
        SELECT minecraft_version FROM classes
        ORDER BY minecraft_version DESC
        LIMIT 1
      `
      )
      .get() as { minecraft_version: string } | undefined;
    return result?.minecraft_version || null;
  }

  /**
   * Search for mappings across classes, methods, and fields
   * Uses semantic search with CamelCase tokenization and fuzzy matching
   */
  search(options: MappingSearchOptions): MappingSearchResult[] {
    const {
      query,
      type = 'all',
      minecraftVersion,
      packageFilter,
      includeJavadoc = true,
      limit = 20,
    } = options;

    const results: MappingSearchResult[] = [];

    // Tokenize query for semantic matching
    const queryTokens = tokenizeQuery(query);
    console.error(
      `[MappingsService] Search query: "${query}" → tokens: [${queryTokens.join(', ')}]`
    );

    // Determine which version to use
    const version = minecraftVersion || this.getLatestVersion();
    if (!version) {
      return [];
    }

    // Generate SQL patterns for database search
    // We fetch MORE results than needed, then re-rank with semantic scoring
    const sqlPatterns = this.generateSqlPatterns(query, queryTokens);

    // Search classes
    if (type === 'all' || type === 'class') {
      const classResults = this.searchClassesSemantic(
        sqlPatterns,
        queryTokens,
        query,
        version,
        packageFilter,
        limit * 3 // Fetch more for re-ranking
      );
      for (const cls of classResults) {
        results.push({
          type: 'class',
          name: cls.name,
          fullName: `${cls.packageName}.${cls.name}`,
          obfuscatedName: cls.obfuscatedName,
          descriptor: null,
          javadoc: includeJavadoc ? cls.javadoc : null,
          className: null,
          packageName: cls.packageName,
          minecraftVersion: cls.minecraftVersion,
          score: cls.score,
        });
      }
    }

    // Search methods
    if (type === 'all' || type === 'method') {
      const methodResults = this.searchMethodsSemantic(
        sqlPatterns,
        queryTokens,
        query,
        version,
        packageFilter,
        limit * 3
      );
      for (const method of methodResults) {
        results.push({
          type: 'method',
          name: method.name,
          fullName: `${method.className}.${method.name}`,
          obfuscatedName: method.obfuscatedName,
          descriptor: method.descriptor,
          javadoc: includeJavadoc ? method.javadoc : null,
          className: method.className,
          packageName: method.packageName,
          minecraftVersion: method.minecraftVersion,
          parameters: method.parameters,
          score: method.score,
        });
      }
    }

    // Search fields
    if (type === 'all' || type === 'field') {
      const fieldResults = this.searchFieldsSemantic(
        sqlPatterns,
        queryTokens,
        query,
        version,
        packageFilter,
        limit * 3
      );
      for (const field of fieldResults) {
        results.push({
          type: 'field',
          name: field.name,
          fullName: `${field.className}.${field.name}`,
          obfuscatedName: field.obfuscatedName,
          descriptor: field.descriptor,
          javadoc: includeJavadoc ? field.javadoc : null,
          className: field.className,
          packageName: field.packageName,
          minecraftVersion: field.minecraftVersion,
          score: field.score,
        });
      }
    }

    // Sort by score and limit
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /**
   * Generate SQL LIKE patterns for initial database search
   * Creates multiple patterns to cast a wide net, then re-rank semantically
   *
   * Strategy:
   * 1. Exact patterns for original query
   * 2. Individual tokens
   * 3. Token pairs
   * 4. Fuzzy patterns (remove single chars, handle common typos)
   * 5. Prefix patterns for short queries
   */
  private generateSqlPatterns(query: string, tokens: string[]): string[] {
    const patterns: string[] = [];
    const queryLower = query.toLowerCase();

    // Original query as-is
    patterns.push(`%${query}%`);

    // Query with spaces removed (for CamelCase matching)
    const joinedQuery = query.replace(/\s+/g, '');
    patterns.push(`%${joinedQuery}%`);

    // Each token individually
    for (const token of tokens) {
      if (token.length >= 2) {
        patterns.push(`%${token}%`);

        // Generate fuzzy variants for longer tokens (typo tolerance)
        if (token.length >= 4) {
          // Single character deletion variants (for typos like "helth" → find "health")
          for (let i = 0; i < token.length; i++) {
            const variant = token.slice(0, i) + token.slice(i + 1);
            if (variant.length >= 3) {
              patterns.push(`%${variant}%`);
            }
          }

          // Single character insertion wildcards (for missing chars)
          // e.g., "helth" → "he%lth" to match "health"
          for (let i = 1; i < token.length; i++) {
            const variant = token.slice(0, i) + '%' + token.slice(i);
            patterns.push(`%${variant}%`);
          }
        }

        // For tokens >= 3 chars, also add prefix pattern
        if (token.length >= 3) {
          patterns.push(`${token}%`); // Starts with token
        }
      }
    }

    // Adjacent token pairs (for multi-word matches)
    for (let i = 0; i < tokens.length - 1; i++) {
      const pair = `%${tokens[i]}%${tokens[i + 1]}%`;
      patterns.push(pair);

      // Also try direct concatenation
      patterns.push(`%${tokens[i]}${tokens[i + 1]}%`);
    }

    // For short queries (likely prefixes), add some common suffixes
    if (queryLower.length <= 4 && tokens.length === 1) {
      const common = ['er', 'ing', 'ed', 'tion', 'ment', 'able', 'ible'];
      for (const suffix of common) {
        patterns.push(`%${tokens[0]}${suffix}%`);
      }
    }

    // Deduplicate
    return [...new Set(patterns)];
  }

  /**
   * Search classes with semantic scoring
   */
  private searchClassesSemantic(
    patterns: string[],
    queryTokens: string[],
    originalQuery: string,
    version: string,
    packageFilter?: string,
    limit: number = 60
  ): Array<{
    id: number;
    name: string;
    obfuscatedName: string | null;
    javadoc: string | null;
    packageName: string;
    minecraftVersion: string;
    score: number;
  }> {
    // Build OR conditions for all patterns
    const patternConditions = patterns.map(() => 'name LIKE ?').join(' OR ');

    // Retrieve more candidates for fuzzy matching, then score and limit
    const retrievalLimit = Math.max(limit * 3, 200);

    let sql = `
      SELECT id, name, obfuscated_name as obfuscatedName, javadoc, package_name as packageName, minecraft_version as minecraftVersion
      FROM classes
      WHERE minecraft_version = ?
        AND (${patternConditions})
    `;
    const params: (string | number)[] = [version, ...patterns];

    if (packageFilter) {
      sql += ` AND package_name LIKE ?`;
      params.push(`%${packageFilter}%`);
    }

    sql += ` LIMIT ?`;
    params.push(retrievalLimit);

    const rawResults = this.db.prepare(sql).all(...params) as Array<{
      id: number;
      name: string;
      obfuscatedName: string | null;
      javadoc: string | null;
      packageName: string;
      minecraftVersion: string;
    }>;

    // Apply semantic scoring and return top results
    return rawResults
      .map((cls) => ({
        ...cls,
        score: calculateSemanticScore(cls.name, queryTokens, originalQuery),
      }))
      .filter((cls) => cls.score > 10)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Search methods with semantic scoring
   */
  private searchMethodsSemantic(
    patterns: string[],
    queryTokens: string[],
    originalQuery: string,
    version: string,
    packageFilter?: string,
    limit: number = 60
  ): Array<{
    id: number;
    name: string;
    obfuscatedName: string | null;
    descriptor: string;
    javadoc: string | null;
    className: string;
    packageName: string;
    minecraftVersion: string;
    parameters: MappingParameter[];
    score: number;
  }> {
    const patternConditions = patterns.map(() => 'm.name LIKE ?').join(' OR ');

    // Retrieve more candidates for fuzzy matching
    const retrievalLimit = Math.max(limit * 3, 200);

    let sql = `
      SELECT
        m.id,
        m.name,
        m.obfuscated_name as obfuscatedName,
        m.descriptor,
        m.javadoc,
        c.name as className,
        c.package_name as packageName,
        c.minecraft_version as minecraftVersion
      FROM methods m
      JOIN classes c ON m.class_id = c.id
      WHERE c.minecraft_version = ?
        AND (${patternConditions})
    `;
    const params: (string | number)[] = [version, ...patterns];

    if (packageFilter) {
      sql += ` AND c.package_name LIKE ?`;
      params.push(`%${packageFilter}%`);
    }

    sql += ` LIMIT ?`;
    params.push(retrievalLimit);

    const rawResults = this.db.prepare(sql).all(...params) as Array<{
      id: number;
      name: string;
      obfuscatedName: string | null;
      descriptor: string;
      javadoc: string | null;
      className: string;
      packageName: string;
      minecraftVersion: string;
    }>;

    // Fetch parameters for each method
    const paramStmt = this.db.prepare(`
      SELECT id, method_id as methodId, param_index as "index", name, javadoc
      FROM parameters
      WHERE method_id = ?
      ORDER BY param_index
    `);

    // Apply semantic scoring and return top results
    return rawResults
      .map((method) => ({
        ...method,
        parameters: paramStmt.all(method.id) as MappingParameter[],
        score: calculateSemanticScore(method.name, queryTokens, originalQuery),
      }))
      .filter((method) => method.score > 10)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Search fields with semantic scoring
   */
  private searchFieldsSemantic(
    patterns: string[],
    queryTokens: string[],
    originalQuery: string,
    version: string,
    packageFilter?: string,
    limit: number = 60
  ): Array<{
    id: number;
    name: string;
    obfuscatedName: string | null;
    descriptor: string;
    javadoc: string | null;
    className: string;
    packageName: string;
    minecraftVersion: string;
    score: number;
  }> {
    const patternConditions = patterns.map(() => 'f.name LIKE ?').join(' OR ');

    // Retrieve more candidates for fuzzy matching
    const retrievalLimit = Math.max(limit * 3, 200);

    let sql = `
      SELECT
        f.id,
        f.name,
        f.obfuscated_name as obfuscatedName,
        f.descriptor,
        f.javadoc,
        c.name as className,
        c.package_name as packageName,
        c.minecraft_version as minecraftVersion
      FROM fields f
      JOIN classes c ON f.class_id = c.id
      WHERE c.minecraft_version = ?
        AND (${patternConditions})
    `;
    const params: (string | number)[] = [version, ...patterns];

    if (packageFilter) {
      sql += ` AND c.package_name LIKE ?`;
      params.push(`%${packageFilter}%`);
    }

    sql += ` LIMIT ?`;
    params.push(retrievalLimit);

    const rawResults = this.db.prepare(sql).all(...params) as Array<{
      id: number;
      name: string;
      obfuscatedName: string | null;
      descriptor: string;
      javadoc: string | null;
      className: string;
      packageName: string;
      minecraftVersion: string;
    }>;

    // Apply semantic scoring and return top results
    return rawResults
      .map((field) => ({
        ...field,
        score: calculateSemanticScore(field.name, queryTokens, originalQuery),
      }))
      .filter((field) => field.score > 10)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Get a class by full name (package.ClassName)
   */
  getClass(fullName: string, minecraftVersion?: string): MappingClass | null {
    const version = minecraftVersion || this.getLatestVersion();
    if (!version) return null;

    const parts = fullName.split('.');
    const className = parts.pop() || fullName;
    const packageName = parts.join('.');

    let sql = `
      SELECT
        c.id,
        c.name,
        c.obfuscated_name as obfuscatedName,
        c.javadoc,
        c.package_name as packageName,
        c.minecraft_version as minecraftVersion,
        (SELECT COUNT(*) FROM methods WHERE class_id = c.id) as methodCount,
        (SELECT COUNT(*) FROM fields WHERE class_id = c.id) as fieldCount
      FROM classes c
      WHERE c.minecraft_version = ?
        AND c.name = ?
    `;
    const params: string[] = [version, className];

    if (packageName) {
      sql += ` AND c.package_name = ?`;
      params.push(packageName);
    }

    return this.db.prepare(sql).get(...params) as MappingClass | null;
  }

  /**
   * Get all methods for a class
   */
  getClassMethods(classId: number): MappingMethod[] {
    const methods = this.db
      .prepare(
        `
        SELECT
          m.id,
          m.class_id as classId,
          c.name as className,
          m.name,
          m.obfuscated_name as obfuscatedName,
          m.descriptor,
          m.javadoc,
          c.minecraft_version as minecraftVersion
        FROM methods m
        JOIN classes c ON m.class_id = c.id
        WHERE m.class_id = ?
        ORDER BY m.name
      `
      )
      .all(classId) as Array<{
      id: number;
      classId: number;
      className: string;
      name: string;
      obfuscatedName: string | null;
      descriptor: string;
      javadoc: string | null;
      minecraftVersion: string;
    }>;

    const paramStmt = this.db.prepare(`
      SELECT id, method_id as methodId, param_index as "index", name, javadoc
      FROM parameters
      WHERE method_id = ?
      ORDER BY param_index
    `);

    return methods.map((method) => ({
      ...method,
      parameters: paramStmt.all(method.id) as MappingParameter[],
    }));
  }

  /**
   * Get all fields for a class
   */
  getClassFields(classId: number): MappingField[] {
    return this.db
      .prepare(
        `
        SELECT
          f.id,
          f.class_id as classId,
          c.name as className,
          f.name,
          f.obfuscated_name as obfuscatedName,
          f.descriptor,
          f.javadoc,
          c.minecraft_version as minecraftVersion
        FROM fields f
        JOIN classes c ON f.class_id = c.id
        WHERE f.class_id = ?
        ORDER BY f.name
      `
      )
      .all(classId) as MappingField[];
  }

  /**
   * Get a method by class name and method name
   */
  getMethod(
    className: string,
    methodName: string,
    minecraftVersion?: string
  ): MappingMethod | null {
    const version = minecraftVersion || this.getLatestVersion();
    if (!version) return null;

    const method = this.db
      .prepare(
        `
        SELECT
          m.id,
          m.class_id as classId,
          c.name as className,
          m.name,
          m.obfuscated_name as obfuscatedName,
          m.descriptor,
          m.javadoc,
          c.minecraft_version as minecraftVersion
        FROM methods m
        JOIN classes c ON m.class_id = c.id
        WHERE c.minecraft_version = ?
          AND (c.name = ? OR (c.package_name || '.' || c.name) = ?)
          AND m.name = ?
        LIMIT 1
      `
      )
      .get(version, className, className, methodName) as
      | {
          id: number;
          classId: number;
          className: string;
          name: string;
          obfuscatedName: string | null;
          descriptor: string;
          javadoc: string | null;
          minecraftVersion: string;
        }
      | undefined;

    if (!method) return null;

    const parameters = this.db
      .prepare(
        `
        SELECT id, method_id as methodId, param_index as "index", name, javadoc
        FROM parameters
        WHERE method_id = ?
        ORDER BY param_index
      `
      )
      .all(method.id) as MappingParameter[];

    return { ...method, parameters };
  }

  /**
   * Lookup by obfuscated name
   */
  lookupObfuscated(obfuscatedName: string, minecraftVersion?: string): MappingSearchResult | null {
    const version = minecraftVersion || this.getLatestVersion();
    if (!version) return null;

    // Check classes
    const cls = this.db
      .prepare(
        `
        SELECT id, name, obfuscated_name as obfuscatedName, javadoc, package_name as packageName, minecraft_version as minecraftVersion
        FROM classes
        WHERE minecraft_version = ? AND obfuscated_name = ?
        LIMIT 1
      `
      )
      .get(version, obfuscatedName) as
      | {
          id: number;
          name: string;
          obfuscatedName: string;
          javadoc: string | null;
          packageName: string;
          minecraftVersion: string;
        }
      | undefined;

    if (cls) {
      return {
        type: 'class',
        name: cls.name,
        fullName: `${cls.packageName}.${cls.name}`,
        obfuscatedName: cls.obfuscatedName,
        descriptor: null,
        javadoc: cls.javadoc,
        className: null,
        packageName: cls.packageName,
        minecraftVersion: cls.minecraftVersion,
        score: 1.0,
      };
    }

    // Check methods
    const method = this.db
      .prepare(
        `
        SELECT
          m.id,
          m.name,
          m.obfuscated_name as obfuscatedName,
          m.descriptor,
          m.javadoc,
          c.name as className,
          c.package_name as packageName,
          c.minecraft_version as minecraftVersion
        FROM methods m
        JOIN classes c ON m.class_id = c.id
        WHERE c.minecraft_version = ? AND m.obfuscated_name = ?
        LIMIT 1
      `
      )
      .get(version, obfuscatedName) as
      | {
          id: number;
          name: string;
          obfuscatedName: string;
          descriptor: string;
          javadoc: string | null;
          className: string;
          packageName: string;
          minecraftVersion: string;
        }
      | undefined;

    if (method) {
      const parameters = this.db
        .prepare(
          `
          SELECT id, method_id as methodId, param_index as "index", name, javadoc
          FROM parameters
          WHERE method_id = ?
          ORDER BY param_index
        `
        )
        .all(method.id) as MappingParameter[];

      return {
        type: 'method',
        name: method.name,
        fullName: `${method.className}.${method.name}`,
        obfuscatedName: method.obfuscatedName,
        descriptor: method.descriptor,
        javadoc: method.javadoc,
        className: method.className,
        packageName: method.packageName,
        minecraftVersion: method.minecraftVersion,
        parameters,
        score: 1.0,
      };
    }

    // Check fields
    const field = this.db
      .prepare(
        `
        SELECT
          f.id,
          f.name,
          f.obfuscated_name as obfuscatedName,
          f.descriptor,
          f.javadoc,
          c.name as className,
          c.package_name as packageName,
          c.minecraft_version as minecraftVersion
        FROM fields f
        JOIN classes c ON f.class_id = c.id
        WHERE c.minecraft_version = ? AND f.obfuscated_name = ?
        LIMIT 1
      `
      )
      .get(version, obfuscatedName) as
      | {
          id: number;
          name: string;
          obfuscatedName: string;
          descriptor: string;
          javadoc: string | null;
          className: string;
          packageName: string;
          minecraftVersion: string;
        }
      | undefined;

    if (field) {
      return {
        type: 'field',
        name: field.name,
        fullName: `${field.className}.${field.name}`,
        obfuscatedName: field.obfuscatedName,
        descriptor: field.descriptor,
        javadoc: field.javadoc,
        className: field.className,
        packageName: field.packageName,
        minecraftVersion: field.minecraftVersion,
        score: 1.0,
      };
    }

    return null;
  }

  /**
   * Get top-level packages
   */
  getPackages(minecraftVersion?: string): string[] {
    const version = minecraftVersion || this.getLatestVersion();
    if (!version) return [];

    const packages = this.db
      .prepare(
        `
        SELECT DISTINCT
          CASE
            WHEN INSTR(package_name, '.') > 0
            THEN SUBSTR(package_name, 1, INSTR(package_name, '.') - 1)
            ELSE package_name
          END as topPackage
        FROM classes
        WHERE minecraft_version = ?
        ORDER BY topPackage
      `
      )
      .all(version) as Array<{ topPackage: string }>;

    return packages.map((p) => p.topPackage);
  }

  /**
   * Browse classes in a package
   */
  getClassesInPackage(packageName: string, minecraftVersion?: string): MappingClass[] {
    const version = minecraftVersion || this.getLatestVersion();
    if (!version) return [];

    return this.db
      .prepare(
        `
        SELECT
          c.id,
          c.name,
          c.obfuscated_name as obfuscatedName,
          c.javadoc,
          c.package_name as packageName,
          c.minecraft_version as minecraftVersion,
          (SELECT COUNT(*) FROM methods WHERE class_id = c.id) as methodCount,
          (SELECT COUNT(*) FROM fields WHERE class_id = c.id) as fieldCount
        FROM classes c
        WHERE c.minecraft_version = ?
          AND c.package_name LIKE ?
        ORDER BY c.name
      `
      )
      .all(version, `${packageName}%`) as MappingClass[];
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }
}
