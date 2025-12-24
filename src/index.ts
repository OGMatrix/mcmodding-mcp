#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { handleGetExample } from './tools/getExample.js';
import { handleGetMinecraftVersion } from './tools/getMinecraftVersion.js';
import { handleSearchDocs } from './tools/searchDocs.js';
import { handleExplainConcept } from './tools/explainConcept.js';
import { DbVersioning } from './db-versioning.js';
import { ModExamplesService } from './services/mod-examples-service.js';
import { MappingsService } from './services/mappings-service.js';
import {
  MOD_EXAMPLES_TOOLS,
  handleSearchModExamples,
  handleGetModExample,
  handleListCanonicalMods,
  handleListModCategories,
  handleGetModPatterns,
} from './tools/modExamples.js';
import {
  MAPPINGS_TOOLS,
  handleSearchMappings,
  handleGetClassDetails,
  handleLookupObfuscated,
  handleGetMethodSignature,
  handleListMappingVersions,
  handleBrowsePackage,
} from './tools/mappings.js';

// Check for CLI commands
if (process.argv.includes('manage')) {
  const { runInstaller } = await import('./cli/manage.js');
  await runInstaller();
  process.exit(0);
}

const server = new Server(
  {
    name: 'mcmodding-mcp',
    version: '0.3.1',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// Base tools always available
const BASE_TOOLS = [
  {
    name: 'search_fabric_docs',
    description:
      'Search Fabric modding documentation for guides and API information. Use this when you need to find documentation about Fabric modding features, APIs, or tutorials.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            "Search query (e.g., 'how to register items', 'mixin tutorial', 'networking'). Be specific for best results. Especially useful for finding guides and API references.",
        },
        category: {
          type: 'string',
          enum: [
            'getting-started',
            'items',
            'blocks',
            'entities',
            'rendering',
            'networking',
            'data-generation',
            'all',
          ],
          description: 'Documentation category to search within (default: all)',
          default: 'all',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_example',
    description:
      'Get code examples for Minecraft modding topics. Returns complete, working code snippets with full context including explanations, source documentation, and metadata. Use this when you need concrete code examples for implementing features.',
    inputSchema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description:
            "Topic or pattern to get examples for (e.g., 'register item', 'block entity', 'mixin', 'networking', 'custom armor'). Can be free-form text.",
        },
        language: {
          type: 'string',
          description: "Programming language (e.g., 'java', 'json', 'groovy')",
          default: 'java',
        },
        loader: {
          type: 'string',
          enum: ['fabric', 'neoforge', 'shared'],
          description: 'Mod loader to filter by',
        },
        minecraft_version: {
          type: 'string',
          description: "Target Minecraft version (e.g., '1.21.4', '1.21.10'). Latest: use 'latest'",
        },
        category: {
          type: 'string',
          enum: [
            'getting-started',
            'items',
            'blocks',
            'entities',
            'rendering',
            'networking',
            'data-generation',
            'commands',
            'sounds',
          ],
          description: 'Documentation category to filter by',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of examples to return (1-10)',
          default: 5,
          minimum: 1,
          maximum: 10,
        },
      },
      required: ['topic'],
    },
  },
  {
    name: 'explain_fabric_concept',
    description:
      'Get detailed explanation of a Fabric or Minecraft modding concept. Use this to understand fundamental concepts, terminology, or architectural patterns.',
    inputSchema: {
      type: 'object',
      properties: {
        concept: {
          type: 'string',
          description:
            "Concept to explain (e.g., 'mixins', 'registries', 'sided logic', 'fabric.mod.json', 'events')",
        },
      },
      required: ['concept'],
    },
  },
  {
    name: 'get_minecraft_version',
    description:
      'Get Minecraft version information from the indexed documentation. Returns either the latest version or all available versions.',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['latest', 'all'],
          description: "Type of version info: 'latest' for newest version, 'all' for complete list",
          default: 'latest',
        },
      },
    },
  },
];

// List available tools (conditionally include mod examples if database exists)
server.setRequestHandler(ListToolsRequestSchema, () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: any[] = [...BASE_TOOLS];

  // Add mod examples tools if database is available
  if (ModExamplesService.isAvailable()) {
    tools.push(...MOD_EXAMPLES_TOOLS);
    console.error('[MCP] Mod examples database available - additional tools registered');
  }

  // Add mappings tools if database is available
  if (MappingsService.isAvailable()) {
    tools.push(...MAPPINGS_TOOLS);
    console.error('[MCP] Parchment mappings database available - additional tools registered');
  }

  return { tools };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'search_fabric_docs': {
      return handleSearchDocs({
        query: (args?.query as string) || '',
        category: args?.category as string | undefined,
        loader: args?.loader as string | undefined,
        minecraftVersion: args?.minecraft_version as string | undefined,
        includeCode: args?.include_code as boolean | undefined,
        limit: args?.limit as number | undefined,
      });
    }

    case 'get_example': {
      return await handleGetExample({
        topic: (args?.topic as string) || '',
        language: args?.language as string | undefined,
        loader: args?.loader as string | undefined,
        minecraftVersion: args?.minecraft_version as string | undefined,
        category: args?.category as string | undefined,
        limit: args?.limit as number | undefined,
      });
    }

    case 'explain_fabric_concept': {
      return await handleExplainConcept({
        concept: (args?.concept as string) || '',
      });
    }

    case 'get_minecraft_version': {
      return handleGetMinecraftVersion({
        type: (args?.type as 'latest' | 'all') || 'latest',
      });
    }

    // Mod examples tools (only work if database is available)
    case 'search_mod_examples': {
      return handleSearchModExamples({
        query: args?.query as string | undefined,
        mod: args?.mod as string | undefined,
        category: args?.category as string | undefined,
        pattern_type: args?.pattern_type as string | undefined,
        complexity: args?.complexity as string | undefined,
        min_quality: args?.min_quality as number | undefined,
        featured_only: args?.featured_only as boolean | undefined,
        limit: args?.limit as number | undefined,
      });
    }

    case 'get_mod_example': {
      return handleGetModExample({
        id: (args?.id as number) || 0,
        include_related: args?.include_related as boolean | undefined,
      });
    }

    case 'list_canonical_mods': {
      return handleListCanonicalMods({
        include_stats: args?.include_stats as boolean | undefined,
      });
    }

    case 'list_mod_categories': {
      return handleListModCategories();
    }

    case 'get_mod_patterns': {
      return handleGetModPatterns();
    }

    // Mappings tools (only work if database is available)
    case 'search_mappings': {
      return handleSearchMappings({
        query: (args?.query as string) || '',
        type: args?.type as 'class' | 'method' | 'field' | 'all' | undefined,
        minecraft_version: args?.minecraft_version as string | undefined,
        package_filter: args?.package_filter as string | undefined,
        include_javadoc: args?.include_javadoc as boolean | undefined,
        limit: args?.limit as number | undefined,
      });
    }

    case 'get_class_details': {
      return handleGetClassDetails({
        class_name: (args?.class_name as string) || '',
        minecraft_version: args?.minecraft_version as string | undefined,
        include_methods: args?.include_methods as boolean | undefined,
        include_fields: args?.include_fields as boolean | undefined,
      });
    }

    case 'lookup_obfuscated': {
      return handleLookupObfuscated({
        obfuscated_name: (args?.obfuscated_name as string) || '',
        minecraft_version: args?.minecraft_version as string | undefined,
      });
    }

    case 'get_method_signature': {
      return handleGetMethodSignature({
        class_name: (args?.class_name as string) || '',
        method_name: (args?.method_name as string) || '',
        minecraft_version: args?.minecraft_version as string | undefined,
      });
    }

    case 'list_mapping_versions': {
      return handleListMappingVersions({
        include_stats: args?.include_stats as boolean | undefined,
      });
    }

    case 'browse_package': {
      return handleBrowsePackage({
        package_name: (args?.package_name as string) || '',
        minecraft_version: args?.minecraft_version as string | undefined,
      });
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

// List available resources
server.setRequestHandler(ListResourcesRequestSchema, () => {
  return {
    resources: [],
  };
});

// Read resource
server.setRequestHandler(ReadResourceRequestSchema, (request) => {
  const { uri } = request.params;
  throw new Error(`Resource not found: ${uri}`);
});

// Start the server
async function main() {
  // Check for database updates on startup
  try {
    console.error('[DbVersioning] Checking for database updates...');
    const versioning = new DbVersioning();
    const updated = await versioning.autoUpdate();
    console.error('[DbVersioning] Update check complete');
    if (updated) {
      console.error('[DbVersioning] Database updated. Restart recommended for best results.');
    } else {
      console.error('[DbVersioning] Database is up to date');
    }
  } catch (error) {
    console.error('[DbVersioning] Error checking for updates:', error);
    // Continue startup even if update fails
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Minecraft Modding MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
