/**
 * Mod Examples Tools - Query canonical examples from indexed open-source mods
 * Provides access to battle-tested patterns from mods like Create, Botania, Applied Energistics 2
 */

import { ModExamplesService } from '../services/mod-examples-service.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL DEFINITIONS (for registration)
// ═══════════════════════════════════════════════════════════════════════════════

export const MOD_EXAMPLES_TOOLS = [
  {
    name: 'search_mod_examples',
    description:
      'Search through canonical code examples from popular open-source mods like Create, Botania, Applied Energistics 2. These are real-world, battle-tested implementations with AI-generated explanations. Use this when you need proven patterns from successful mods.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description:
            'Search query (e.g., "block entity", "custom renderer", "networking", "registration"). Free-form text search.',
        },
        mod: {
          type: 'string',
          description:
            'Filter by specific mod name (e.g., "Create", "Botania", "Applied Energistics 2", "Fabric API")',
        },
        category: {
          type: 'string',
          enum: [
            'blocks',
            'items',
            'entities',
            'tile-entities',
            'rendering',
            'gui',
            'networking',
            'worldgen',
            'data-generation',
            'recipes',
            'events',
            'registry',
            'api-design',
            'cross-platform',
            'storage-systems',
            'animation',
            'particles',
            'sounds',
            'commands',
            'config',
          ],
          description: 'Filter by pattern category',
        },
        pattern_type: {
          type: 'string',
          description:
            'Filter by pattern type (e.g., "block-registration", "event-handler", "renderer", "packet-handler")',
        },
        complexity: {
          type: 'string',
          enum: ['beginner', 'intermediate', 'advanced', 'expert'],
          description: 'Filter by complexity level',
        },
        min_quality: {
          type: 'number',
          description:
            'Minimum quality score (0.0-1.0). Higher = more curated examples. Default: 0.5',
          minimum: 0,
          maximum: 1,
        },
        featured_only: {
          type: 'boolean',
          description: 'Only return featured (highest quality) examples',
        },
        limit: {
          type: 'number',
          description: 'Maximum results (1-20). Default: 5',
          minimum: 1,
          maximum: 20,
        },
      },
    },
  },
  {
    name: 'get_mod_example',
    description:
      'Get detailed information about a specific mod example by ID. Returns full code, explanation, best practices, pitfalls, imports, and related examples. Use after searching to get complete details.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: {
          type: 'number',
          description: 'Example ID (from search results)',
        },
        include_related: {
          type: 'boolean',
          description: 'Include related examples (similar patterns, dependencies). Default: true',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'list_canonical_mods',
    description:
      'List all indexed canonical mods with their example counts and descriptions. Use this to discover what mods are available for examples.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        include_stats: {
          type: 'boolean',
          description: 'Include database statistics. Default: false',
        },
      },
    },
  },
  {
    name: 'list_mod_categories',
    description:
      'List all available pattern categories with example counts. Use this to discover what types of examples are available.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'get_mod_patterns',
    description:
      'Get all available pattern types with counts. Useful for discovering specific implementation patterns.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

export interface SearchModExamplesParams {
  query?: string;
  mod?: string;
  category?: string;
  pattern_type?: string;
  complexity?: string;
  min_quality?: number;
  featured_only?: boolean;
  limit?: number;
}

export function handleSearchModExamples(params: SearchModExamplesParams): CallToolResult {
  try {
    if (!ModExamplesService.isAvailable()) {
      return {
        content: [
          {
            type: 'text',
            text: 'Mod examples database is not available. This is an optional feature that provides examples from canonical open-source mods.\n\nThe standard documentation tools (search_fabric_docs, get_example) are still available.',
          },
        ],
      };
    }

    const service = new ModExamplesService();

    try {
      const examples = service.searchExamples({
        query: params.query,
        modName: params.mod,
        category: params.category,
        patternType: params.pattern_type,
        complexity: params.complexity,
        minQualityScore: params.min_quality ?? 0.5,
        featured: params.featured_only,
        limit: Math.min(Math.max(params.limit || 5, 1), 20),
      });

      // Format with summary info for each result
      let output = '';

      if (examples.length === 0) {
        output = 'No mod examples found matching your criteria.\n\n';
        output += '**Suggestions:**\n';
        output += '- Try broader search terms\n';
        output += '- Remove category or complexity filters\n';
        output += '- Use `list_canonical_mods` to see available mods\n';
        output += '- Use `list_mod_categories` to see available categories\n';
      } else {
        output = `Found ${examples.length} canonical mod example${examples.length > 1 ? 's' : ''}:\n\n`;

        examples.forEach((ex, i) => {
          output += `### ${i + 1}. ${ex.title}\n`;
          output += `**ID:** ${ex.id} | **Mod:** ${ex.modName} | **Quality:** ${(ex.qualityScore * 100).toFixed(0)}%`;
          if (ex.isFeatured) output += ' | ⭐ Featured';
          output += '\n';
          output += `**Category:** ${ex.categoryName || ex.category} | **Pattern:** ${ex.patternType} | **Complexity:** ${ex.complexity}\n`;
          output += `\n${ex.caption}\n\n`;
          output += `\`\`\`${ex.language}\n${ex.code.slice(0, 500)}${ex.code.length > 500 ? '\n// ... (truncated, use get_mod_example for full code)' : ''}\n\`\`\`\n\n`;
          output += `→ Use \`get_mod_example\` with ID ${ex.id} for full details\n\n---\n\n`;
        });
      }

      return {
        content: [{ type: 'text', text: output }],
      };
    } finally {
      service.close();
    }
  } catch (error) {
    console.error('[search_mod_examples] Error:', error);
    return {
      content: [
        {
          type: 'text',
          text: `Error searching mod examples: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      ],
      isError: true,
    };
  }
}

export interface GetModExampleParams {
  id: number;
  include_related?: boolean;
}

export function handleGetModExample(params: GetModExampleParams): CallToolResult {
  try {
    if (!ModExamplesService.isAvailable()) {
      return {
        content: [
          {
            type: 'text',
            text: 'Mod examples database is not available.',
          },
        ],
      };
    }

    const service = new ModExamplesService();

    try {
      const example = service.getExample(params.id);

      if (!example) {
        return {
          content: [
            {
              type: 'text',
              text: `Example with ID ${params.id} not found. Use search_mod_examples to find valid example IDs.`,
            },
          ],
        };
      }

      let output = service.formatExampleForAI(example);

      // Add related examples if requested
      if (params.include_related !== false) {
        const relations = service.getRelatedExamples(params.id);

        if (relations.length > 0) {
          output += '\n---\n\n## Related Examples\n\n';

          relations.forEach((rel) => {
            const relationLabel =
              {
                uses: '📦 Uses',
                extends: '🔄 Extends',
                similar_to: '🔗 Similar to',
                alternative_to: '↔️ Alternative to',
                requires: '⚠️ Requires',
                complements: '✨ Complements',
              }[rel.relationType] || rel.relationType;

            output += `**${relationLabel}** (ID: ${rel.targetId}, strength: ${(rel.strength * 100).toFixed(0)}%)\n`;
            output += `- ${rel.targetTitle}\n`;
            output += `- ${rel.description}\n\n`;
          });
        }
      }

      return {
        content: [{ type: 'text', text: output }],
      };
    } finally {
      service.close();
    }
  } catch (error) {
    console.error('[get_mod_example] Error:', error);
    return {
      content: [
        {
          type: 'text',
          text: `Error retrieving example: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      ],
      isError: true,
    };
  }
}

export interface ListCanonicalModsParams {
  include_stats?: boolean;
}

export function handleListCanonicalMods(params: ListCanonicalModsParams): CallToolResult {
  try {
    if (!ModExamplesService.isAvailable()) {
      return {
        content: [
          {
            type: 'text',
            text: 'Mod examples database is not available.',
          },
        ],
      };
    }

    const service = new ModExamplesService();

    try {
      const mods = service.listMods();
      let output = '# Indexed Canonical Mods\n\n';
      output += 'These are high-quality, open-source mods with AI-analyzed code examples:\n\n';

      if (params.include_stats) {
        const stats = service.getStats();
        output += '## Database Statistics\n\n';
        output += `| Metric | Value |\n`;
        output += `|--------|-------|\n`;
        output += `| Total Mods | ${stats.mods} |\n`;
        output += `| Total Examples | ${stats.examples} |\n`;
        output += `| Relationships | ${stats.relations} |\n`;
        output += `| Featured Examples | ${stats.featuredExamples} |\n`;
        output += `| Avg Quality Score | ${(stats.avgQualityScore * 100).toFixed(0)}% |\n\n`;
      }

      output += '## Available Mods\n\n';

      mods.forEach((mod) => {
        output += `### ${mod.name}\n`;
        output += `**Repository:** [${mod.repo}](https://github.com/${mod.repo})\n`;
        output += `**Loader:** ${mod.loader} | **Stars:** ${mod.starCount.toLocaleString()} | **Examples:** ${mod.exampleCount}\n`;
        output += `**Versions:** ${mod.minecraftVersions.join(', ') || 'Various'}\n\n`;
        output += `${mod.description}\n\n`;

        if (mod.architectureNotes) {
          output += `*Architecture:* ${mod.architectureNotes.slice(0, 200)}${mod.architectureNotes.length > 200 ? '...' : ''}\n\n`;
        }

        output += '---\n\n';
      });

      return {
        content: [{ type: 'text', text: output }],
      };
    } finally {
      service.close();
    }
  } catch (error) {
    console.error('[list_canonical_mods] Error:', error);
    return {
      content: [
        {
          type: 'text',
          text: `Error listing mods: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      ],
      isError: true,
    };
  }
}

export function handleListModCategories(): CallToolResult {
  try {
    if (!ModExamplesService.isAvailable()) {
      return {
        content: [
          {
            type: 'text',
            text: 'Mod examples database is not available.',
          },
        ],
      };
    }

    const service = new ModExamplesService();

    try {
      const categories = service.listCategories();

      let output = '# Pattern Categories\n\n';
      output += 'Available categories for filtering mod examples:\n\n';
      output += '| Category | Name | Examples | Description |\n';
      output += '|----------|------|----------|-------------|\n';

      categories.forEach((cat) => {
        output += `| ${cat.icon} \`${cat.slug}\` | ${cat.name} | ${cat.exampleCount} | ${cat.description} |\n`;
      });

      output += '\n**Usage:** `search_mod_examples` with `category` parameter\n';

      return {
        content: [{ type: 'text', text: output }],
      };
    } finally {
      service.close();
    }
  } catch (error) {
    console.error('[list_mod_categories] Error:', error);
    return {
      content: [
        {
          type: 'text',
          text: `Error listing categories: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      ],
      isError: true,
    };
  }
}

export function handleGetModPatterns(): CallToolResult {
  try {
    if (!ModExamplesService.isAvailable()) {
      return {
        content: [
          {
            type: 'text',
            text: 'Mod examples database is not available.',
          },
        ],
      };
    }

    const service = new ModExamplesService();

    try {
      const patterns = service.getPatternTypes();

      let output = '# Pattern Types\n\n';
      output += 'Specific implementation patterns found in indexed mods:\n\n';
      output += '| Pattern Type | Example Count |\n';
      output += '|--------------|---------------|\n';

      patterns.forEach((p) => {
        output += `| \`${p.type}\` | ${p.count} |\n`;
      });

      output += '\n**Usage:** `search_mod_examples` with `pattern_type` parameter\n';

      return {
        content: [{ type: 'text', text: output }],
      };
    } finally {
      service.close();
    }
  } catch (error) {
    console.error('[get_mod_patterns] Error:', error);
    return {
      content: [
        {
          type: 'text',
          text: `Error getting patterns: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      ],
      isError: true,
    };
  }
}
