/**
 * Get Minecraft version information tool
 * Returns version data from indexed documentation
 */

import { ExampleService } from '../services/example-service.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export interface GetMinecraftVersionParams {
  type?: 'latest' | 'all';
}

/**
 * Handle get_minecraft_version tool request
 * Returns Minecraft version information from indexed docs
 */
export function handleGetMinecraftVersion(params: GetMinecraftVersionParams): CallToolResult {
  try {
    const exampleService = new ExampleService();
    const { type = 'latest' } = params;

    if (type === 'all') {
      const topics = exampleService.getAvailableTopics();
      exampleService.close();

      if (topics.versions.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No Minecraft versions found in the indexed documentation. Please run the indexer first.',
            },
          ],
        };
      }

      let output = `## Available Minecraft Versions\n\n`;
      output += `Found ${topics.versions.length} version(s) in the documentation:\n\n`;

      for (const version of topics.versions) {
        output += `- ${version}\n`;
      }

      output += `\n**Latest:** ${topics.versions[0] || 'unknown'}\n`;

      return {
        content: [
          {
            type: 'text',
            text: output,
          },
        ],
      };
    }

    // Default: return latest version
    const latestVersion = exampleService.getLatestMinecraftVersion();
    exampleService.close();

    return {
      content: [
        {
          type: 'text',
          text: `The latest Minecraft version in the documentation is: **${latestVersion}**`,
        },
      ],
    };
  } catch (error) {
    console.error('[get_minecraft_version] Error:', error);

    return {
      content: [
        {
          type: 'text',
          text: `Error retrieving Minecraft version: ${error instanceof Error ? error.message : 'Unknown error'}\n\nThe documentation database may not be initialized.`,
        },
      ],
    };
  }
}
