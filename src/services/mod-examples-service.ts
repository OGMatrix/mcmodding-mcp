/**
 * Mod Examples Service - Query canonical mod examples from indexed open-source mods
 * Provides access to high-quality, AI-analyzed code examples from mods like Create, Botania, AE2
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

// ═══════════════════════════════════════════════════════════════════════════════
// INTERFACES
// ═══════════════════════════════════════════════════════════════════════════════

export interface ModInfo {
  id: number;
  name: string;
  repo: string;
  loader: string;
  description: string;
  readmeSummary: string;
  architectureNotes: string;
  starCount: number;
  minecraftVersions: string[];
  exampleCount: number;
}

export interface ModExample {
  id: number;
  modName: string;
  modRepo: string;
  filePath: string;
  fileUrl: string;
  startLine: number;
  endLine: number;
  title: string;
  code: string;
  language: string;
  caption: string;
  explanation: string;
  patternType: string;
  complexity: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  category: string;
  categoryName: string;
  bestPractices: string[];
  potentialPitfalls: string[];
  useCases: string[];
  keywords: string[];
  minecraftConcepts: string[];
  qualityScore: number;
  isFeatured: boolean;
  tags: string[];
  imports: Array<{ path: string; type: string; isCritical: boolean }>;
  apiReferences: Array<{ className: string; methodName?: string; apiType: string }>;
}

export interface ExampleRelation {
  sourceId: number;
  targetId: number;
  relationType: 'uses' | 'extends' | 'similar_to' | 'alternative_to' | 'requires' | 'complements';
  description: string;
  strength: number;
  targetTitle: string;
  targetCaption: string;
}

export interface ModExampleSearchOptions {
  query?: string;
  modName?: string;
  category?: string;
  patternType?: string;
  complexity?: string;
  minQualityScore?: number;
  featured?: boolean;
  tags?: string[];
  limit?: number;
}

export interface CategoryInfo {
  slug: string;
  name: string;
  description: string;
  icon: string;
  exampleCount: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SERVICE CLASS
// ═══════════════════════════════════════════════════════════════════════════════

export class ModExamplesService {
  private db: Database.Database;
  private static dbPath = path.join(process.cwd(), 'data', 'mod-examples.db');

  constructor(dbPath?: string) {
    const finalPath = dbPath || ModExamplesService.dbPath;
    console.error(`[ModExamplesService] Using database at: ${finalPath}`);
    this.db = new Database(finalPath, { readonly: true });
  }

  /**
   * Check if the mod examples database is available
   */
  static isAvailable(): boolean {
    return fs.existsSync(ModExamplesService.dbPath);
  }

  /**
   * Get database statistics
   */
  getStats(): {
    mods: number;
    examples: number;
    relations: number;
    categories: number;
    featuredExamples: number;
    avgQualityScore: number;
  } {
    const stats = this.db
      .prepare(
        `
      SELECT
        (SELECT COUNT(*) FROM mods) as mods,
        (SELECT COUNT(*) FROM examples) as examples,
        (SELECT COUNT(*) FROM example_relations) as relations,
        (SELECT COUNT(*) FROM categories) as categories,
        (SELECT COUNT(*) FROM examples WHERE is_featured = TRUE) as featuredExamples,
        (SELECT AVG(quality_score) FROM examples) as avgQualityScore
    `
      )
      .get() as {
      mods: number;
      examples: number;
      relations: number;
      categories: number;
      featuredExamples: number;
      avgQualityScore: number;
    };

    return {
      ...stats,
      avgQualityScore: Math.round((stats.avgQualityScore || 0) * 100) / 100,
    };
  }

  /**
   * List all indexed canonical mods
   */
  listMods(): ModInfo[] {
    const mods = this.db
      .prepare(
        `
      SELECT
        m.id,
        m.name,
        m.repo,
        m.loader,
        m.description,
        m.readme_summary as readmeSummary,
        m.architecture_notes as architectureNotes,
        m.star_count as starCount,
        m.minecraft_versions as minecraftVersions,
        COUNT(e.id) as exampleCount
      FROM mods m
      LEFT JOIN examples e ON e.mod_id = m.id
      GROUP BY m.id
      ORDER BY m.priority DESC, m.star_count DESC
    `
      )
      .all() as Array<ModInfo & { minecraftVersions: string }>;

    return mods.map((m) => ({
      ...m,
      minecraftVersions: JSON.parse(m.minecraftVersions || '[]') as string[],
    }));
  }

  /**
   * Get a specific mod by name
   */
  getMod(name: string): ModInfo | null {
    const mod = this.db
      .prepare(
        `
      SELECT
        m.id,
        m.name,
        m.repo,
        m.loader,
        m.description,
        m.readme_summary as readmeSummary,
        m.architecture_notes as architectureNotes,
        m.star_count as starCount,
        m.minecraft_versions as minecraftVersions,
        COUNT(e.id) as exampleCount
      FROM mods m
      LEFT JOIN examples e ON e.mod_id = m.id
      WHERE LOWER(m.name) = LOWER(?)
      GROUP BY m.id
    `
      )
      .get(name) as (ModInfo & { minecraftVersions: string }) | undefined;

    if (!mod) return null;

    return {
      ...mod,
      minecraftVersions: JSON.parse(mod.minecraftVersions || '[]') as string[],
    };
  }

  /**
   * List all categories with example counts
   */
  listCategories(): CategoryInfo[] {
    return this.db
      .prepare(
        `
      SELECT
        c.slug,
        c.name,
        c.description,
        c.icon,
        COUNT(e.id) as exampleCount
      FROM categories c
      LEFT JOIN examples e ON e.category_id = c.id
      GROUP BY c.id
      HAVING exampleCount > 0
      ORDER BY c.sort_order ASC
    `
      )
      .all() as CategoryInfo[];
  }

  /**
   * Search for mod examples
   */
  searchExamples(options: ModExampleSearchOptions): ModExample[] {
    const {
      query,
      modName,
      category,
      patternType,
      complexity,
      minQualityScore = 0,
      featured,
      tags,
      limit = 10,
    } = options;

    let sql = `
      SELECT DISTINCT
        e.id,
        m.name as modName,
        m.repo as modRepo,
        e.file_path as filePath,
        e.file_url as fileUrl,
        e.start_line as startLine,
        e.end_line as endLine,
        e.title,
        e.code,
        e.language,
        e.caption,
        e.explanation,
        e.pattern_type as patternType,
        e.complexity,
        c.slug as category,
        c.name as categoryName,
        e.best_practices as bestPractices,
        e.potential_pitfalls as potentialPitfalls,
        e.use_cases as useCases,
        e.keywords,
        e.minecraft_concepts as minecraftConcepts,
        e.quality_score as qualityScore,
        e.is_featured as isFeatured
      FROM examples e
      JOIN mods m ON e.mod_id = m.id
      LEFT JOIN categories c ON e.category_id = c.id
    `;

    const conditions: string[] = [];
    const params: unknown[] = [];

    // Text search using FTS if query provided
    if (query && query.trim()) {
      sql += ` JOIN examples_fts fts ON fts.rowid = e.id`;
      conditions.push(`examples_fts MATCH ?`);
      // Convert query to FTS format
      const ftsQuery = query
        .split(/\s+/)
        .filter((t) => t.length > 1)
        .map((t) => `"${t}"*`)
        .join(' OR ');
      params.push(ftsQuery || query);
    }

    if (modName) {
      conditions.push(`LOWER(m.name) = LOWER(?)`);
      params.push(modName);
    }

    if (category) {
      conditions.push(`c.slug = ?`);
      params.push(category);
    }

    if (patternType) {
      conditions.push(`e.pattern_type = ?`);
      params.push(patternType);
    }

    if (complexity) {
      conditions.push(`e.complexity = ?`);
      params.push(complexity);
    }

    if (minQualityScore > 0) {
      conditions.push(`e.quality_score >= ?`);
      params.push(minQualityScore);
    }

    if (featured !== undefined) {
      conditions.push(`e.is_featured = ?`);
      params.push(featured ? 1 : 0);
    }

    if (tags && tags.length > 0) {
      sql += ` JOIN example_tags et ON et.example_id = e.id JOIN tags t ON t.id = et.tag_id`;
      conditions.push(`t.slug IN (${tags.map(() => '?').join(', ')})`);
      params.push(...tags);
    }

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }

    sql += ` ORDER BY e.quality_score DESC, e.is_featured DESC LIMIT ?`;
    params.push(limit);

    const examples = this.db.prepare(sql).all(...params) as Array<
      Omit<
        ModExample,
        | 'bestPractices'
        | 'potentialPitfalls'
        | 'useCases'
        | 'keywords'
        | 'minecraftConcepts'
        | 'tags'
        | 'imports'
        | 'apiReferences'
      > & {
        bestPractices: string;
        potentialPitfalls: string;
        useCases: string;
        keywords: string;
        minecraftConcepts: string;
      }
    >;

    return examples.map((e) => this.enrichExample(e));
  }

  /**
   * Get a specific example by ID with full details
   */
  getExample(id: number): ModExample | null {
    const example = this.db
      .prepare(
        `
      SELECT
        e.id,
        m.name as modName,
        m.repo as modRepo,
        e.file_path as filePath,
        e.file_url as fileUrl,
        e.start_line as startLine,
        e.end_line as endLine,
        e.title,
        e.code,
        e.language,
        e.caption,
        e.explanation,
        e.pattern_type as patternType,
        e.complexity,
        c.slug as category,
        c.name as categoryName,
        e.best_practices as bestPractices,
        e.potential_pitfalls as potentialPitfalls,
        e.use_cases as useCases,
        e.keywords,
        e.minecraft_concepts as minecraftConcepts,
        e.quality_score as qualityScore,
        e.is_featured as isFeatured
      FROM examples e
      JOIN mods m ON e.mod_id = m.id
      LEFT JOIN categories c ON e.category_id = c.id
      WHERE e.id = ?
    `
      )
      .get(id) as
      | (Omit<
          ModExample,
          | 'bestPractices'
          | 'potentialPitfalls'
          | 'useCases'
          | 'keywords'
          | 'minecraftConcepts'
          | 'tags'
          | 'imports'
          | 'apiReferences'
        > & {
          bestPractices: string;
          potentialPitfalls: string;
          useCases: string;
          keywords: string;
          minecraftConcepts: string;
        })
      | undefined;

    if (!example) return null;

    return this.enrichExample(example);
  }

  /**
   * Get related examples for a given example
   */
  getRelatedExamples(exampleId: number): ExampleRelation[] {
    return this.db
      .prepare(
        `
      SELECT
        r.source_id as sourceId,
        r.target_id as targetId,
        r.relation_type as relationType,
        r.description,
        r.strength,
        e.title as targetTitle,
        e.caption as targetCaption
      FROM example_relations r
      JOIN examples e ON e.id = r.target_id
      WHERE r.source_id = ?
      ORDER BY r.strength DESC
    `
      )
      .all(exampleId) as ExampleRelation[];
  }

  /**
   * Get featured examples (high quality, curated)
   */
  getFeaturedExamples(limit: number = 10): ModExample[] {
    return this.searchExamples({
      featured: true,
      minQualityScore: 0.7,
      limit,
    });
  }

  /**
   * Get examples by pattern type
   */
  getExamplesByPattern(patternType: string, limit: number = 10): ModExample[] {
    return this.searchExamples({
      patternType,
      minQualityScore: 0.5,
      limit,
    });
  }

  /**
   * Get available pattern types
   */
  getPatternTypes(): Array<{ type: string; count: number }> {
    return this.db
      .prepare(
        `
      SELECT pattern_type as type, COUNT(*) as count
      FROM examples
      WHERE pattern_type IS NOT NULL
      GROUP BY pattern_type
      ORDER BY count DESC
    `
      )
      .all() as Array<{ type: string; count: number }>;
  }

  /**
   * Enrich example with tags, imports, and API references
   */
  private enrichExample(
    example: Omit<
      ModExample,
      | 'bestPractices'
      | 'potentialPitfalls'
      | 'useCases'
      | 'keywords'
      | 'minecraftConcepts'
      | 'tags'
      | 'imports'
      | 'apiReferences'
    > & {
      bestPractices: string;
      potentialPitfalls: string;
      useCases: string;
      keywords: string;
      minecraftConcepts: string;
    }
  ): ModExample {
    // Get tags
    const tags = this.db
      .prepare(
        `
      SELECT t.slug
      FROM tags t
      JOIN example_tags et ON et.tag_id = t.id
      WHERE et.example_id = ?
    `
      )
      .all(example.id) as Array<{ slug: string }>;

    // Get imports
    const imports = this.db
      .prepare(
        `
      SELECT import_path as path, import_type as type, is_critical as isCritical
      FROM example_imports
      WHERE example_id = ?
    `
      )
      .all(example.id) as Array<{ path: string; type: string; isCritical: number }>;

    // Get API references
    const apiRefs = this.db
      .prepare(
        `
      SELECT class_name as className, method_name as methodName, api_type as apiType
      FROM api_references
      WHERE example_id = ?
    `
      )
      .all(example.id) as Array<{ className: string; methodName: string | null; apiType: string }>;

    return {
      ...example,
      bestPractices: JSON.parse(example.bestPractices || '[]') as string[],
      potentialPitfalls: JSON.parse(example.potentialPitfalls || '[]') as string[],
      useCases: JSON.parse(example.useCases || '[]') as string[],
      keywords: JSON.parse(example.keywords || '[]') as string[],
      minecraftConcepts: JSON.parse(example.minecraftConcepts || '[]') as string[],
      tags: tags.map((t) => t.slug),
      imports: imports.map((i) => ({ ...i, isCritical: Boolean(i.isCritical) })),
      apiReferences: apiRefs.map((r) => ({
        className: r.className,
        methodName: r.methodName || undefined,
        apiType: r.apiType,
      })),
    };
  }

  /**
   * Format example for AI-friendly output
   */
  formatExampleForAI(example: ModExample): string {
    let output = '';

    output += `## ${example.title}\n\n`;
    output += `**Source:** ${example.modName} (${example.modRepo})\n`;
    output += `**File:** [${example.filePath}](${example.fileUrl}) (lines ${example.startLine}-${example.endLine})\n`;
    output += `**Category:** ${example.categoryName || example.category}\n`;
    output += `**Pattern:** ${example.patternType}\n`;
    output += `**Complexity:** ${example.complexity}\n`;
    output += `**Quality Score:** ${(example.qualityScore * 100).toFixed(0)}%\n`;

    if (example.isFeatured) {
      output += `**Featured:** Yes (curated high-quality example)\n`;
    }

    if (example.tags.length > 0) {
      output += `**Tags:** ${example.tags.join(', ')}\n`;
    }

    output += `\n### Description\n${example.caption}\n`;

    if (example.explanation) {
      output += `\n### Detailed Explanation\n${example.explanation}\n`;
    }

    output += `\n### Code\n\`\`\`${example.language}\n${example.code}\n\`\`\`\n`;

    if (example.bestPractices.length > 0) {
      output += `\n### Best Practices\n`;
      example.bestPractices.forEach((bp) => {
        output += `- ${bp}\n`;
      });
    }

    if (example.potentialPitfalls.length > 0) {
      output += `\n### Potential Pitfalls\n`;
      example.potentialPitfalls.forEach((pp) => {
        output += `- ⚠️ ${pp}\n`;
      });
    }

    if (example.useCases.length > 0) {
      output += `\n### When to Use\n`;
      example.useCases.forEach((uc) => {
        output += `- ${uc}\n`;
      });
    }

    if (example.minecraftConcepts.length > 0) {
      output += `\n### Minecraft Concepts Used\n`;
      output += example.minecraftConcepts.join(', ') + '\n';
    }

    if (example.imports.length > 0) {
      const criticalImports = example.imports.filter((i) => i.isCritical);
      if (criticalImports.length > 0) {
        output += `\n### Required Imports\n\`\`\`java\n`;
        criticalImports.forEach((i) => {
          output += `import ${i.path};\n`;
        });
        output += `\`\`\`\n`;
      }
    }

    return output;
  }

  /**
   * Format multiple examples for AI output
   */
  formatExamplesForAI(examples: ModExample[]): string {
    if (examples.length === 0) {
      return 'No mod examples found matching your criteria.\n\nTry:\n- Using broader search terms\n- Removing filters\n- Checking available categories with list_mod_categories';
    }

    let output = `Found ${examples.length} canonical mod example${examples.length > 1 ? 's' : ''}:\n\n`;

    examples.forEach((example, index) => {
      output += `---\n\n`;
      output += `### Example ${index + 1} of ${examples.length}\n\n`;
      output += this.formatExampleForAI(example);
    });

    return output;
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }
}
