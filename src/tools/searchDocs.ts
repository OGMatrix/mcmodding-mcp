/**
 * Search Fabric Documentation Tool Handler
 * Full implementation using intelligent multi-strategy search with query expansion and relevance scoring
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { SearchService } from '../services/search-service.js';
import type { SearchResult, SearchOptions } from '../services/search-service.js';

export interface SearchDocsParams {
  query: string;
  category?: string;
  loader?: string;
  minecraftVersion?: string;
  includeCode?: boolean;
  limit?: number;
}

// Singleton instance for reuse (better performance)
let searchServiceInstance: SearchService | null = null;

function getSearchService(): SearchService {
  if (!searchServiceInstance) {
    searchServiceInstance = new SearchService();
  }
  return searchServiceInstance;
}

/**
 * Handle the search_fabric_docs tool call
 * Performs intelligent multi-strategy search with:
 * - FTS5 full-text search with fallback to LIKE patterns
 * - Query tokenization and synonym expansion
 * - Relevance scoring with weighted factors
 * - Result deduplication and ranking
 * - AI-friendly formatted output
 */
export async function handleSearchDocs(params: SearchDocsParams): Promise<CallToolResult> {
  const { query, category, loader, minecraftVersion, includeCode = true, limit = 10 } = params;

  // Validate required parameters
  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: 'Error: Query parameter is required and cannot be empty.',
        },
      ],
      isError: true,
    };
  }

  const trimmedQuery = query.trim();

  // Validate limit
  const effectiveLimit = Math.min(Math.max(1, limit), 20);

  try {
    const searchService = getSearchService();

    // Build search options
    const searchOptions: SearchOptions = {
      query: trimmedQuery,
      limit: effectiveLimit,
      includeCode,
    };

    // Add optional filters
    if (category && category !== 'all') {
      searchOptions.category = category;
    }

    if (loader) {
      searchOptions.loader = loader;
    }

    if (minecraftVersion) {
      // Handle 'latest' version
      if (minecraftVersion.toLowerCase() === 'latest') {
        const stats = searchService.getStats();
        const versions = stats.versions.sort((a, b) => {
          const partsA = a.split('.').map(Number);
          const partsB = b.split('.').map(Number);
          for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
            const numA = partsA[i] || 0;
            const numB = partsB[i] || 0;
            if (numA !== numB) return numB - numA;
          }
          return 0;
        });
        if (versions[0]) {
          searchOptions.minecraftVersion = versions[0];
        }
      } else {
        searchOptions.minecraftVersion = minecraftVersion;
      }
    }

    // Perform search
    const results = await searchService.search(searchOptions);

    // Format results for AI
    const formattedOutput = searchService.formatForAI(results, trimmedQuery);

    // Add metadata for AI to use
    const metadata = buildMetadata(results, searchOptions, searchService);

    return {
      content: [
        {
          type: 'text',
          text: formattedOutput + '\n\n' + metadata,
        },
      ],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[searchDocs] Error: ${errorMessage}`);

    return {
      content: [
        {
          type: 'text',
          text: `Error searching documentation: ${errorMessage}\n\nPlease ensure the documentation database has been indexed. Run 'npm run index' to build the database.`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Build metadata section for AI context
 */
function buildMetadata(
  results: SearchResult[],
  options: SearchOptions,
  service: SearchService
): string {
  const stats = service.getStats();

  let metadata = '---\n**Search Metadata:**\n';
  metadata += `- Query: "${options.query}"\n`;
  metadata += `- Results found: ${results.length}\n`;

  if (options.category) {
    metadata += `- Category filter: ${options.category}\n`;
  }

  if (options.loader) {
    metadata += `- Loader filter: ${options.loader}\n`;
  }

  if (options.minecraftVersion) {
    metadata += `- Minecraft version filter: ${options.minecraftVersion}\n`;
  }

  metadata += `\n**Database Stats:**\n`;
  metadata += `- Total documents indexed: ${stats.totalDocuments}\n`;
  metadata += `- Total sections: ${stats.totalSections}\n`;
  metadata += `- Available loaders: ${stats.loaders.join(', ')}\n`;
  metadata += `- Available versions: ${stats.versions.slice(0, 5).join(', ')}${stats.versions.length > 5 ? '...' : ''}\n`;

  // Add suggestions based on results
  if (results.length === 0) {
    metadata += '\n**Suggestions:**\n';
    metadata += '- Try broader search terms\n';
    metadata += '- Remove category/loader filters\n';
    metadata += '- Use synonyms (e.g., "register" instead of "create")\n';
  } else if (results.length < 3) {
    metadata += '\n**Note:** Few results found. Consider:\n';
    metadata += '- Using `get_example` for specific code examples\n';
    metadata += '- Trying related terms or concepts\n';
  }

  return metadata;
}

/**
 * Search documentation (legacy function for compatibility)
 * @deprecated Use handleSearchDocs instead
 */
export async function searchDocs(params: SearchDocsParams): Promise<SearchResult[]> {
  const searchService = getSearchService();
  return await searchService.search({
    query: params.query,
    category: params.category,
    minecraftVersion: params.minecraftVersion,
    limit: 10,
  });
}

/**
 * Get available categories for filtering
 */
export function getAvailableCategories(): string[] {
  return [
    'getting-started',
    'items',
    'blocks',
    'entities',
    'rendering',
    'networking',
    'data-generation',
    'commands',
    'sounds',
    'events',
    'mixins',
  ];
}

/**
 * Get available loaders for filtering
 */
export function getAvailableLoaders(): string[] {
  return ['fabric', 'neoforge', 'shared'];
}
