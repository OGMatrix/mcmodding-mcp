/**
 * Mappings Tools - Query Minecraft class/method/field mappings from Parchment data
 * Provides AI assistants with deobfuscation information, parameter names, and Javadocs
 */

import { MappingsService } from '../services/mappings-service.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL DEFINITIONS (for registration)
// ═══════════════════════════════════════════════════════════════════════════════

export const MAPPINGS_TOOLS = [
  {
    name: 'search_mappings',
    description:
      'Search Minecraft class, method, and field mappings from Parchment data. Returns deobfuscated names, parameter names, and Javadoc documentation. Use this when you need to understand Minecraft internals or find the correct class/method names for modding.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description:
            'Search query - class name, method name, or field name (e.g., "Block", "getBlockState", "player", "ServerLevel")',
        },
        type: {
          type: 'string',
          enum: ['class', 'method', 'field', 'all'],
          description: 'Filter by mapping type. Default: all',
          default: 'all',
        },
        minecraft_version: {
          type: 'string',
          description:
            'Target Minecraft version (e.g., "1.21.4", "1.20.1"). Uses latest if not specified.',
        },
        package_filter: {
          type: 'string',
          description:
            'Filter by package name (e.g., "net.minecraft.world", "net.minecraft.server")',
        },
        include_javadoc: {
          type: 'boolean',
          description: 'Include Javadoc documentation in results. Default: true',
          default: true,
        },
        limit: {
          type: 'number',
          description: 'Maximum results to return (1-50). Default: 15',
          minimum: 1,
          maximum: 50,
          default: 15,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_class_details',
    description:
      'Get detailed information about a specific Minecraft class including all its methods and fields with their parameter names and Javadocs.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        class_name: {
          type: 'string',
          description:
            'Full class name (e.g., "net.minecraft.world.level.block.Block" or just "Block")',
        },
        minecraft_version: {
          type: 'string',
          description: 'Target Minecraft version. Uses latest if not specified.',
        },
        include_methods: {
          type: 'boolean',
          description: 'Include method details. Default: true',
          default: true,
        },
        include_fields: {
          type: 'boolean',
          description: 'Include field details. Default: true',
          default: true,
        },
      },
      required: ['class_name'],
    },
  },
  {
    name: 'lookup_obfuscated',
    description:
      'Look up the deobfuscated name for an obfuscated Minecraft class, method, or field name. Useful when encountering obfuscated names in crash logs or decompiled code.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        obfuscated_name: {
          type: 'string',
          description: 'The obfuscated name to look up (e.g., "m_46859_", "f_46443_", "C_12345_")',
        },
        minecraft_version: {
          type: 'string',
          description: 'Target Minecraft version. Uses latest if not specified.',
        },
      },
      required: ['obfuscated_name'],
    },
  },
  {
    name: 'get_method_signature',
    description:
      'Get the full signature of a specific method including parameter names, types, and Javadoc. Useful when you need to understand how to call or override a Minecraft method.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        class_name: {
          type: 'string',
          description: 'The class containing the method',
        },
        method_name: {
          type: 'string',
          description: 'The method name to look up',
        },
        minecraft_version: {
          type: 'string',
          description: 'Target Minecraft version. Uses latest if not specified.',
        },
      },
      required: ['class_name', 'method_name'],
    },
  },
  {
    name: 'list_mapping_versions',
    description: 'List all Minecraft versions available in the mappings database with statistics.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        include_stats: {
          type: 'boolean',
          description: 'Include detailed statistics. Default: false',
          default: false,
        },
      },
    },
  },
  {
    name: 'browse_package',
    description:
      'Browse classes in a specific Minecraft package. Useful for discovering available classes in a package.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        package_name: {
          type: 'string',
          description:
            'Package name to browse (e.g., "net.minecraft.world.level.block", "net.minecraft.server.level")',
        },
        minecraft_version: {
          type: 'string',
          description: 'Target Minecraft version. Uses latest if not specified.',
        },
      },
      required: ['package_name'],
    },
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

const NOT_AVAILABLE_MESSAGE =
  'Parchment mappings database is not available. This is an optional feature that provides Minecraft class/method/field mappings with parameter names and Javadocs.\n\n' +
  'To install it, run: `npx mcmodding-mcp manage`\n\n' +
  'The standard documentation tools (search_fabric_docs, get_example) are still available for modding guidance.';

export interface SearchMappingsParams {
  query: string;
  type?: 'class' | 'method' | 'field' | 'all';
  minecraft_version?: string;
  package_filter?: string;
  include_javadoc?: boolean;
  limit?: number;
}

export function handleSearchMappings(params: SearchMappingsParams): CallToolResult {
  try {
    if (!MappingsService.isAvailable()) {
      return {
        content: [{ type: 'text', text: NOT_AVAILABLE_MESSAGE }],
      };
    }

    const service = new MappingsService();

    try {
      const results = service.search({
        query: params.query,
        type: params.type || 'all',
        minecraftVersion: params.minecraft_version,
        packageFilter: params.package_filter,
        includeJavadoc: params.include_javadoc !== false,
        limit: Math.min(Math.max(params.limit || 15, 1), 50),
      });

      if (results.length === 0) {
        const version = params.minecraft_version || service.getLatestVersion() || 'unknown';
        let output = `No mappings found for "${params.query}" in Minecraft ${version}.\n\n`;
        output += '**Suggestions:**\n';
        output += '- Try a broader search term\n';
        output += '- Check the spelling of the class/method name\n';
        output += '- Try without the package filter\n';
        output += '- Use `list_mapping_versions` to see available versions\n';

        return { content: [{ type: 'text', text: output }] };
      }

      let output = `Found ${results.length} mapping${results.length > 1 ? 's' : ''} for "${params.query}":\n\n`;

      for (const result of results) {
        output += `### ${result.type.charAt(0).toUpperCase() + result.type.slice(1)}: \`${result.fullName}\`\n`;

        if (result.obfuscatedName) {
          output += `**Obfuscated:** \`${result.obfuscatedName}\`\n`;
        }

        if (result.descriptor) {
          output += `**Descriptor:** \`${result.descriptor}\`\n`;
        }

        if (result.type === 'method' && result.parameters && result.parameters.length > 0) {
          output += `**Parameters:**\n`;
          for (const param of result.parameters) {
            output += `  - \`${param.name}\``;
            if (param.javadoc) {
              output += ` — ${param.javadoc}`;
            }
            output += '\n';
          }
        }

        if (result.javadoc) {
          output += `**Javadoc:** ${result.javadoc}\n`;
        }

        output += `**Version:** ${result.minecraftVersion}\n`;
        output += '\n---\n\n';
      }

      return { content: [{ type: 'text', text: output.trim() }] };
    } finally {
      service.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error searching mappings: ${message}` }],
      isError: true,
    };
  }
}

export interface GetClassDetailsParams {
  class_name: string;
  minecraft_version?: string;
  include_methods?: boolean;
  include_fields?: boolean;
}

export function handleGetClassDetails(params: GetClassDetailsParams): CallToolResult {
  try {
    if (!MappingsService.isAvailable()) {
      return {
        content: [{ type: 'text', text: NOT_AVAILABLE_MESSAGE }],
      };
    }

    const service = new MappingsService();

    try {
      const cls = service.getClass(params.class_name, params.minecraft_version);

      if (!cls) {
        const version = params.minecraft_version || service.getLatestVersion() || 'unknown';
        return {
          content: [
            {
              type: 'text',
              text: `Class "${params.class_name}" not found in Minecraft ${version} mappings.\n\nTry using \`search_mappings\` to find the correct class name.`,
            },
          ],
        };
      }

      let output = `# Class: \`${cls.packageName}.${cls.name}\`\n\n`;

      if (cls.obfuscatedName) {
        output += `**Obfuscated:** \`${cls.obfuscatedName}\`\n`;
      }
      output += `**Package:** \`${cls.packageName}\`\n`;
      output += `**Version:** ${cls.minecraftVersion}\n`;

      if (cls.javadoc) {
        output += `\n**Javadoc:**\n${cls.javadoc}\n`;
      }

      // Methods
      if (params.include_methods !== false) {
        const methods = service.getClassMethods(cls.id);
        output += `\n## Methods (${methods.length})\n\n`;

        if (methods.length === 0) {
          output += '_No methods with mappings found._\n';
        } else {
          for (const method of methods.slice(0, 30)) {
            // Limit to avoid huge outputs
            output += `### \`${method.name}\`\n`;
            output += `**Descriptor:** \`${method.descriptor}\`\n`;

            if (method.obfuscatedName) {
              output += `**Obfuscated:** \`${method.obfuscatedName}\`\n`;
            }

            if (method.parameters.length > 0) {
              output += `**Parameters:**\n`;
              for (const param of method.parameters) {
                output += `  - \`${param.name}\``;
                if (param.javadoc) {
                  output += ` — ${param.javadoc}`;
                }
                output += '\n';
              }
            }

            if (method.javadoc) {
              output += `**Javadoc:** ${method.javadoc}\n`;
            }

            output += '\n';
          }

          if (methods.length > 30) {
            output += `\n_...and ${methods.length - 30} more methods. Use \`search_mappings\` with the class name to find specific methods._\n`;
          }
        }
      }

      // Fields
      if (params.include_fields !== false) {
        const fields = service.getClassFields(cls.id);
        output += `\n## Fields (${fields.length})\n\n`;

        if (fields.length === 0) {
          output += '_No fields with mappings found._\n';
        } else {
          for (const field of fields) {
            output += `- **\`${field.name}\`** (\`${field.descriptor}\`)`;
            if (field.obfuscatedName) {
              output += ` — obf: \`${field.obfuscatedName}\``;
            }
            if (field.javadoc) {
              output += `\n  ${field.javadoc}`;
            }
            output += '\n';
          }
        }
      }

      return { content: [{ type: 'text', text: output.trim() }] };
    } finally {
      service.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error getting class details: ${message}` }],
      isError: true,
    };
  }
}

export interface LookupObfuscatedParams {
  obfuscated_name: string;
  minecraft_version?: string;
}

export function handleLookupObfuscated(params: LookupObfuscatedParams): CallToolResult {
  try {
    if (!MappingsService.isAvailable()) {
      return {
        content: [{ type: 'text', text: NOT_AVAILABLE_MESSAGE }],
      };
    }

    const service = new MappingsService();

    try {
      const result = service.lookupObfuscated(params.obfuscated_name, params.minecraft_version);

      if (!result) {
        const version = params.minecraft_version || service.getLatestVersion() || 'unknown';
        return {
          content: [
            {
              type: 'text',
              text: `Obfuscated name "${params.obfuscated_name}" not found in Minecraft ${version} mappings.\n\nNote: Parchment mappings are based on Mojang mappings. The obfuscated name format may differ between mapping systems.`,
            },
          ],
        };
      }

      let output = `# Deobfuscation Result\n\n`;
      output += `**Obfuscated:** \`${result.obfuscatedName}\`\n`;
      output += `**Deobfuscated:** \`${result.fullName}\`\n`;
      output += `**Type:** ${result.type}\n`;
      output += `**Version:** ${result.minecraftVersion}\n`;

      if (result.descriptor) {
        output += `**Descriptor:** \`${result.descriptor}\`\n`;
      }

      if (result.type === 'method' && result.parameters && result.parameters.length > 0) {
        output += `\n**Parameters:**\n`;
        for (const param of result.parameters) {
          output += `  - \`${param.name}\``;
          if (param.javadoc) {
            output += ` — ${param.javadoc}`;
          }
          output += '\n';
        }
      }

      if (result.javadoc) {
        output += `\n**Javadoc:**\n${result.javadoc}\n`;
      }

      return { content: [{ type: 'text', text: output.trim() }] };
    } finally {
      service.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error looking up obfuscated name: ${message}` }],
      isError: true,
    };
  }
}

export interface GetMethodSignatureParams {
  class_name: string;
  method_name: string;
  minecraft_version?: string;
}

export function handleGetMethodSignature(params: GetMethodSignatureParams): CallToolResult {
  try {
    if (!MappingsService.isAvailable()) {
      return {
        content: [{ type: 'text', text: NOT_AVAILABLE_MESSAGE }],
      };
    }

    const service = new MappingsService();

    try {
      const method = service.getMethod(
        params.class_name,
        params.method_name,
        params.minecraft_version
      );

      if (!method) {
        const version = params.minecraft_version || service.getLatestVersion() || 'unknown';
        return {
          content: [
            {
              type: 'text',
              text: `Method "${params.method_name}" not found in class "${params.class_name}" for Minecraft ${version}.\n\nTry using \`search_mappings\` to find the correct method name.`,
            },
          ],
        };
      }

      let output = `# Method: \`${method.className}.${method.name}\`\n\n`;
      output += `**Descriptor:** \`${method.descriptor}\`\n`;

      if (method.obfuscatedName) {
        output += `**Obfuscated:** \`${method.obfuscatedName}\`\n`;
      }

      output += `**Version:** ${method.minecraftVersion}\n`;

      if (method.parameters.length > 0) {
        output += `\n## Parameters\n\n`;
        for (const param of method.parameters) {
          output += `- **\`${param.name}\`** (index ${param.index})`;
          if (param.javadoc) {
            output += `\n  ${param.javadoc}`;
          }
          output += '\n';
        }
      } else {
        output += '\n_No parameter names available for this method._\n';
      }

      if (method.javadoc) {
        output += `\n## Javadoc\n\n${method.javadoc}\n`;
      }

      return { content: [{ type: 'text', text: output.trim() }] };
    } finally {
      service.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error getting method signature: ${message}` }],
      isError: true,
    };
  }
}

export interface ListMappingVersionsParams {
  include_stats?: boolean;
}

export function handleListMappingVersions(params: ListMappingVersionsParams): CallToolResult {
  try {
    if (!MappingsService.isAvailable()) {
      return {
        content: [{ type: 'text', text: NOT_AVAILABLE_MESSAGE }],
      };
    }

    const service = new MappingsService();

    try {
      const versions = service.getMinecraftVersions();

      if (versions.length === 0) {
        return {
          content: [
            { type: 'text', text: 'No Minecraft versions found in the mappings database.' },
          ],
        };
      }

      let output = `# Available Minecraft Versions\n\n`;
      output += `Found ${versions.length} version${versions.length > 1 ? 's' : ''} with Parchment mappings:\n\n`;

      for (const version of versions) {
        output += `- **${version}**`;
        if (version === versions[0]) {
          output += ' _(latest)_';
        }
        output += '\n';
      }

      if (params.include_stats) {
        const stats = service.getStats();
        output += `\n## Database Statistics\n\n`;
        output += `- **Total Classes:** ${stats.totalClasses.toLocaleString()}\n`;
        output += `- **Total Methods:** ${stats.totalMethods.toLocaleString()}\n`;
        output += `- **Total Fields:** ${stats.totalFields.toLocaleString()}\n`;
        output += `- **Total Parameters:** ${stats.totalParameters.toLocaleString()}\n`;
        output += `- **Documented Methods:** ${stats.documentedMethods.toLocaleString()}\n`;
        output += `- **Documented Fields:** ${stats.documentedFields.toLocaleString()}\n`;

        if (stats.topPackages.length > 0) {
          output += `\n### Top Packages\n\n`;
          for (const pkg of stats.topPackages) {
            output += `- \`${pkg.packageName}\` (${pkg.count} classes)\n`;
          }
        }
      }

      return { content: [{ type: 'text', text: output.trim() }] };
    } finally {
      service.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error listing mapping versions: ${message}` }],
      isError: true,
    };
  }
}

export interface BrowsePackageParams {
  package_name: string;
  minecraft_version?: string;
}

export function handleBrowsePackage(params: BrowsePackageParams): CallToolResult {
  try {
    if (!MappingsService.isAvailable()) {
      return {
        content: [{ type: 'text', text: NOT_AVAILABLE_MESSAGE }],
      };
    }

    const service = new MappingsService();

    try {
      const classes = service.getClassesInPackage(params.package_name, params.minecraft_version);
      const version = params.minecraft_version || service.getLatestVersion() || 'unknown';

      if (classes.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `No classes found in package "${params.package_name}" for Minecraft ${version}.\n\nTry a broader package name or check the spelling.`,
            },
          ],
        };
      }

      let output = `# Package: \`${params.package_name}\`\n\n`;
      output += `Found ${classes.length} class${classes.length > 1 ? 'es' : ''} in Minecraft ${version}:\n\n`;

      // Group by sub-package
      const bySubPackage = new Map<string, typeof classes>();
      for (const cls of classes) {
        const subPkg = cls.packageName;
        if (!bySubPackage.has(subPkg)) {
          bySubPackage.set(subPkg, []);
        }
        bySubPackage.get(subPkg)!.push(cls);
      }

      for (const [pkg, pkgClasses] of Array.from(bySubPackage.entries()).sort()) {
        if (bySubPackage.size > 1) {
          output += `## \`${pkg}\`\n\n`;
        }

        for (const cls of pkgClasses.slice(0, 50)) {
          output += `- **\`${cls.name}\`**`;
          output += ` — ${cls.methodCount} methods, ${cls.fieldCount} fields`;
          if (cls.javadoc) {
            const shortDoc =
              cls.javadoc.length > 100 ? cls.javadoc.substring(0, 100) + '...' : cls.javadoc;
            output += `\n  _${shortDoc}_`;
          }
          output += '\n';
        }

        if (pkgClasses.length > 50) {
          output += `\n_...and ${pkgClasses.length - 50} more classes._\n`;
        }

        output += '\n';
      }

      output += `\nUse \`get_class_details\` to see the full details of a specific class.`;

      return { content: [{ type: 'text', text: output.trim() }] };
    } finally {
      service.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error browsing package: ${message}` }],
      isError: true,
    };
  }
}
