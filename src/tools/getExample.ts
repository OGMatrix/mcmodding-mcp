/**
 * Get code examples tool - Retrieves code examples from indexed documentation
 * Optimized for AI consumption with rich context and metadata
 */

import { ExampleService } from '../services/example-service.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export interface GetExampleParams {
  topic: string;
  language?: string;
  loader?: string;
  minecraftVersion?: string;
  category?: string;
  limit?: number;
}

/**
 * Handle get_example tool request
 * Returns formatted code examples with full context for AI
 */
export async function handleGetExample(params: GetExampleParams): Promise<CallToolResult> {
  try {
    const { topic, language = 'java', loader, minecraftVersion, category, limit = 5 } = params;

    // Validate topic
    if (!topic || !topic.trim()) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: Topic parameter is required. Please specify what you want examples for (e.g., "register item", "block entity", "networking").',
          },
        ],
        isError: true,
      };
    }

    const exampleService = new ExampleService();

    if (params.minecraftVersion === 'latest') {
      params.minecraftVersion = exampleService.getLatestMinecraftVersion();
    }

    // Validate and clamp limit
    const finalLimit = Math.min(Math.max(limit, 1), 10);

    console.error(`[get_example] Searching for: "${topic}" (${language}, limit: ${finalLimit})`);

    // Get examples (synchronous - uses SQLite)
    const examples = await exampleService.getExamples({
      topic,
      language,
      loader,
      minecraftVersion,
      category,
      limit: finalLimit,
    });

    // Handle no results
    if (examples.length === 0) {
      exampleService.close();

      let message = `No code examples found for "${topic}"`;

      if (language !== 'java') {
        message += ` in ${language}`;
      }

      if (loader) {
        message += ` for ${loader}`;
      }

      if (minecraftVersion) {
        message += ` (version ${minecraftVersion})`;
      }

      message += '.\n\n**Suggestions:**\n';
      message +=
        '- Try using more general search terms (e.g., "item" instead of "custom item registration")\n';
      message += '- Remove version or loader filters\n';
      message += '- Check if the topic is covered in the Fabric documentation\n';
      message += '- Try searching with the `search_fabric_docs` tool first\n';

      console.error(`[get_example] No results found for "${topic}"`);

      return {
        content: [
          {
            type: 'text',
            text: message,
          },
        ],
      };
    }

    // Format results for AI
    const formattedOutput = exampleService.formatForAI(examples);

    // Close after formatting
    exampleService.close();

    console.error(`[get_example] Returning ${examples.length} example(s) for "${topic}"`);

    return {
      content: [
        {
          type: 'text',
          text: formattedOutput,
        },
      ],
    };
  } catch (error) {
    console.error('[get_example] Error:', error);

    return {
      content: [
        {
          type: 'text',
          text: `Error retrieving examples: ${error instanceof Error ? error.message : 'Unknown error'}\n\nThe documentation database may not be initialized. Please ensure the indexer has been run with \`npm run index-docs\`.`,
        },
      ],
    };
  }
}

/**
 * Get available example metadata (for debugging/info)
 */
export function getAvailableTopics(): {
  categories: string[];
  languages: Array<{ language: string; count: number }>;
  loaders: string[];
  versions: string[];
} {
  const exampleService = new ExampleService();
  const topics = exampleService.getAvailableTopics();
  exampleService.close();
  return topics;
}
