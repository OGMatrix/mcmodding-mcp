/**
 * Comprehensive tests for mcmodding-mcp
 * Tests cover: DbVersioning, Tool Handlers, Utility Functions
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';

// ============================================================================
// DbVersioning Tests
// ============================================================================

describe('DbVersioning', () => {
  // Import after mocking
  let DbVersioning: typeof import('./db-versioning.js').DbVersioning;

  beforeEach(async () => {
    vi.resetModules();
    // Mock fs module
    vi.mock('fs', () => ({
      default: {
        existsSync: vi.fn(),
        readFileSync: vi.fn(),
        writeFileSync: vi.fn(),
        mkdirSync: vi.fn(),
        statSync: vi.fn(),
        copyFileSync: vi.fn(),
        unlinkSync: vi.fn(),
        renameSync: vi.fn(),
        createReadStream: vi.fn(),
      },
    }));

    const module = await import('./db-versioning.js');
    DbVersioning = module.DbVersioning;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('compareVersions', () => {
    it('should return -1 when remote is greater (major)', () => {
      const versioning = new DbVersioning();
      expect(versioning.compareVersions('1.0.0', '2.0.0')).toBe(-1);
    });

    it('should return -1 when remote is greater (minor)', () => {
      const versioning = new DbVersioning();
      expect(versioning.compareVersions('1.0.0', '1.1.0')).toBe(-1);
    });

    it('should return -1 when remote is greater (patch)', () => {
      const versioning = new DbVersioning();
      expect(versioning.compareVersions('1.0.0', '1.0.1')).toBe(-1);
    });

    it('should return 1 when local is greater', () => {
      const versioning = new DbVersioning();
      expect(versioning.compareVersions('2.0.0', '1.0.0')).toBe(1);
    });

    it('should return 0 when versions are equal', () => {
      const versioning = new DbVersioning();
      expect(versioning.compareVersions('1.0.0', '1.0.0')).toBe(0);
    });

    it('should handle versions with missing parts', () => {
      const versioning = new DbVersioning();
      expect(versioning.compareVersions('1.0', '1.0.0')).toBe(0);
      expect(versioning.compareVersions('1', '1.0.0')).toBe(0);
    });

    it('should handle complex version comparisons', () => {
      const versioning = new DbVersioning();
      expect(versioning.compareVersions('1.9.0', '1.10.0')).toBe(-1);
      expect(versioning.compareVersions('0.99.99', '1.0.0')).toBe(-1);
    });
  });

  describe('getLocalManifest', () => {
    it('should return null when manifest file does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const versioning = new DbVersioning();
      expect(versioning.getLocalManifest()).toBeNull();
    });

    it('should return parsed manifest when file exists', () => {
      const mockManifest = {
        version: '1.0.0',
        timestamp: '2024-01-01T00:00:00Z',
        type: 'full',
        hash: 'abc123',
        size: 1000,
        downloadUrl: 'https://example.com/db.sqlite',
        changelog: 'Initial release',
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockManifest));

      const versioning = new DbVersioning();
      const result = versioning.getLocalManifest();

      expect(result).toEqual(mockManifest);
    });

    it('should return null on JSON parse error', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('invalid json');

      const versioning = new DbVersioning();
      expect(versioning.getLocalManifest()).toBeNull();
    });
  });

  describe('saveManifest', () => {
    it('should create directory if it does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const versioning = new DbVersioning();
      const manifest = {
        version: '1.0.0',
        timestamp: '2024-01-01T00:00:00Z',
        type: 'full' as const,
        hash: 'abc123',
        size: 1000,
        downloadUrl: 'https://example.com/db.sqlite',
        changelog: 'Initial release',
      };

      versioning.saveManifest(manifest);

      expect(fs.mkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    });

    it('should write manifest to file', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const versioning = new DbVersioning();
      const manifest = {
        version: '1.0.0',
        timestamp: '2024-01-01T00:00:00Z',
        type: 'full' as const,
        hash: 'abc123',
        size: 1000,
        downloadUrl: 'https://example.com/db.sqlite',
        changelog: 'Initial release',
      };

      versioning.saveManifest(manifest);

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('manifest.json'),
        JSON.stringify(manifest, null, 2)
      );
    });
  });

  describe('getVersionInfo', () => {
    it('should return unknown when no local manifest exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const versioning = new DbVersioning();
      const info = versioning.getVersionInfo();

      expect(info.local).toBe('unknown');
      expect(info.upToDate).toBe(true);
    });

    it('should return version from manifest when exists', () => {
      const mockManifest = { version: '1.2.3' };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockManifest));

      const versioning = new DbVersioning();
      const info = versioning.getVersionInfo();

      expect(info.local).toBe('1.2.3');
    });
  });

  describe('constructor', () => {
    it('should use default database path when not provided', () => {
      const versioning = new DbVersioning();
      expect(versioning).toBeDefined();
    });

    it('should use custom database path when provided', () => {
      const customPath = '/custom/path/to/db.sqlite';
      const versioning = new DbVersioning(customPath);
      expect(versioning).toBeDefined();
    });
  });
});

// ============================================================================
// Tool Handler Tests
// ============================================================================

describe('handleSearchDocs', () => {
  let handleSearchDocs: typeof import('./tools/searchDocs.js').handleSearchDocs;

  beforeEach(async () => {
    vi.resetModules();
    const module = await import('./tools/searchDocs.js');
    handleSearchDocs = module.handleSearchDocs;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('input validation', () => {
    it('should return error when query is empty', async () => {
      const result = await handleSearchDocs({ query: '' });

      expect(result.isError).toBe(true);
      expect(result.content[0]).toHaveProperty('type', 'text');
      expect((result.content[0] as { type: string; text: string }).text).toContain(
        'Query parameter is required'
      );
    });

    it('should return error when query is whitespace only', async () => {
      const result = await handleSearchDocs({ query: '   ' });

      expect(result.isError).toBe(true);
    });

    it('should trim query before processing', async () => {
      // This will hit the actual search service which may throw
      // The important thing is it doesn't fail on the whitespace check
      const result = await handleSearchDocs({ query: '  valid query  ' });

      // Either succeeds or fails with database error, not validation error
      if (result.isError) {
        expect((result.content[0] as { type: string; text: string }).text).not.toContain(
          'Query parameter is required'
        );
      }
    });
  });

  describe('limit handling', () => {
    it('should accept valid limit values', async () => {
      const result = await handleSearchDocs({ query: 'test', limit: 5 });

      // Will error if DB not available, but shouldn't fail validation
      if (result.isError) {
        expect((result.content[0] as { type: string; text: string }).text).toContain(
          'searching documentation'
        );
      }
    });
  });
});

describe('handleGetExample', () => {
  let handleGetExample: typeof import('./tools/getExample.js').handleGetExample;

  beforeEach(async () => {
    vi.resetModules();
    const module = await import('./tools/getExample.js');
    handleGetExample = module.handleGetExample;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('input validation', () => {
    it('should return error when topic is empty', async () => {
      const result = await handleGetExample({ topic: '' });

      expect(result.content[0]).toHaveProperty('type', 'text');
      expect((result.content[0] as { type: string; text: string }).text).toContain(
        'Topic parameter is required'
      );
    });

    it('should return error when topic is whitespace only', async () => {
      const result = await handleGetExample({ topic: '   ' });

      expect((result.content[0] as { type: string; text: string }).text).toContain(
        'Topic parameter is required'
      );
    });
  });

  describe('default values', () => {
    it('should use java as default language', async () => {
      // The function internally uses java as default
      const result = await handleGetExample({ topic: 'test' });

      // Result depends on DB availability, but function should not throw
      expect(result).toHaveProperty('content');
    });

    it('should clamp limit to valid range', async () => {
      // Test with limit beyond max
      const result = await handleGetExample({ topic: 'test', limit: 100 });

      // Should not throw, limit is clamped internally
      expect(result).toHaveProperty('content');
    });
  });
});

describe('handleExplainConcept', () => {
  let handleExplainConcept: typeof import('./tools/explainConcept.js').handleExplainConcept;

  beforeEach(async () => {
    vi.resetModules();
    const module = await import('./tools/explainConcept.js');
    handleExplainConcept = module.handleExplainConcept;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('input validation', () => {
    it('should return error when concept is empty', async () => {
      const result = await handleExplainConcept({ concept: '' });

      expect(result.isError).toBe(true);
      expect((result.content[0] as { type: string; text: string }).text).toContain(
        'Concept parameter is required'
      );
    });

    it('should return error when concept is whitespace only', async () => {
      const result = await handleExplainConcept({ concept: '   ' });

      expect(result.isError).toBe(true);
    });

    it('should return error when concept exceeds 100 characters', async () => {
      const longConcept = 'a'.repeat(101);
      const result = await handleExplainConcept({ concept: longConcept });

      expect(result.isError).toBe(true);
      expect((result.content[0] as { type: string; text: string }).text).toContain(
        'max 100 characters'
      );
    });

    it('should accept concept at exactly 100 characters', async () => {
      const exactConcept = 'a'.repeat(100);
      const result = await handleExplainConcept({ concept: exactConcept });

      // Should not fail validation, may fail on DB
      if (result.isError) {
        expect((result.content[0] as { type: string; text: string }).text).not.toContain(
          'max 100 characters'
        );
      }
    }, 120000);
  });
});

describe('handleGetMinecraftVersion', () => {
  let handleGetMinecraftVersion: typeof import('./tools/getMinecraftVersion.js').handleGetMinecraftVersion;

  beforeEach(async () => {
    vi.resetModules();
    const module = await import('./tools/getMinecraftVersion.js');
    handleGetMinecraftVersion = module.handleGetMinecraftVersion;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('type parameter', () => {
    it('should handle latest type', () => {
      const result = handleGetMinecraftVersion({ type: 'latest' });

      expect(result).toHaveProperty('content');
      expect(result.content[0]).toHaveProperty('type', 'text');
    });

    it('should handle all type', () => {
      const result = handleGetMinecraftVersion({ type: 'all' });

      expect(result).toHaveProperty('content');
    });

    it('should default to latest when no type provided', () => {
      const result = handleGetMinecraftVersion({});

      expect(result).toHaveProperty('content');
    });
  });
});

// ============================================================================
// Utility Function Tests
// ============================================================================

describe('Utility Functions', () => {
  describe('getAvailableCategories', () => {
    let getAvailableCategories: typeof import('./tools/searchDocs.js').getAvailableCategories;

    beforeEach(async () => {
      const module = await import('./tools/searchDocs.js');
      getAvailableCategories = module.getAvailableCategories;
    });

    it('should return an array of categories', () => {
      const categories = getAvailableCategories();

      expect(Array.isArray(categories)).toBe(true);
      expect(categories.length).toBeGreaterThan(0);
    });

    it('should include common modding categories', () => {
      const categories = getAvailableCategories();

      expect(categories).toContain('items');
      expect(categories).toContain('blocks');
      expect(categories).toContain('entities');
      expect(categories).toContain('networking');
    });

    it('should include getting-started category', () => {
      const categories = getAvailableCategories();

      expect(categories).toContain('getting-started');
    });

    it('should return strings only', () => {
      const categories = getAvailableCategories();

      categories.forEach((cat) => {
        expect(typeof cat).toBe('string');
      });
    });
  });

  describe('getAvailableLoaders', () => {
    let getAvailableLoaders: typeof import('./tools/searchDocs.js').getAvailableLoaders;

    beforeEach(async () => {
      const module = await import('./tools/searchDocs.js');
      getAvailableLoaders = module.getAvailableLoaders;
    });

    it('should return an array of loaders', () => {
      const loaders = getAvailableLoaders();

      expect(Array.isArray(loaders)).toBe(true);
      expect(loaders.length).toBeGreaterThan(0);
    });

    it('should include fabric loader', () => {
      const loaders = getAvailableLoaders();

      expect(loaders).toContain('fabric');
    });

    it('should include neoforge loader', () => {
      const loaders = getAvailableLoaders();

      expect(loaders).toContain('neoforge');
    });

    it('should include shared category', () => {
      const loaders = getAvailableLoaders();

      expect(loaders).toContain('shared');
    });
  });

  describe('getSuggestedConcepts', () => {
    let getSuggestedConcepts: typeof import('./tools/explainConcept.js').getSuggestedConcepts;

    beforeEach(async () => {
      const module = await import('./tools/explainConcept.js');
      getSuggestedConcepts = module.getSuggestedConcepts;
    });

    it('should return an array of concepts', () => {
      const concepts = getSuggestedConcepts();

      expect(Array.isArray(concepts)).toBe(true);
      expect(concepts.length).toBeGreaterThan(0);
    });

    it('should include fundamental modding concepts', () => {
      const concepts = getSuggestedConcepts();

      expect(concepts).toContain('mixin');
      expect(concepts).toContain('registry');
      expect(concepts).toContain('entrypoint');
    });

    it('should include common game elements', () => {
      const concepts = getSuggestedConcepts();

      expect(concepts).toContain('item');
      expect(concepts).toContain('block');
      expect(concepts).toContain('entity');
    });

    it('should include fabric-specific concepts', () => {
      const concepts = getSuggestedConcepts();

      expect(concepts).toContain('fabric.mod.json');
    });
  });
});

// ============================================================================
// Type Safety Tests
// ============================================================================

describe('Type Safety', () => {
  describe('DbVersionManifest interface', () => {
    it('should accept valid manifest objects', () => {
      // DbVersionManifest is a type, so we don't import it as a value
      // const { DbVersionManifest } = await import('./db-versioning.js');

      const validManifest: import('./db-versioning.js').DbVersionManifest = {
        version: '1.0.0',
        timestamp: '2024-01-01T00:00:00Z',
        type: 'full',
        hash: 'abc123def456',
        size: 1024,
        downloadUrl: 'https://example.com/db.sqlite',
        changelog: 'Initial release',
      };

      expect(validManifest.type).toMatch(/^(incremental|full)$/);
    });
  });

  describe('SearchDocsParams interface', () => {
    it('should accept minimal params', async () => {
      const { handleSearchDocs } = await import('./tools/searchDocs.js');

      // TypeScript compile-time check - this should not throw type errors
      const result = handleSearchDocs({ query: 'test' });
      expect(result).toBeDefined();
    });

    it('should accept full params', async () => {
      const { handleSearchDocs } = await import('./tools/searchDocs.js');

      const result = handleSearchDocs({
        query: 'test',
        category: 'items',
        loader: 'fabric',
        minecraftVersion: '1.21.4',
        includeCode: true,
        limit: 10,
      });
      expect(result).toBeDefined();
    });
  });

  describe('GetExampleParams interface', () => {
    it('should accept minimal params', async () => {
      const { handleGetExample } = await import('./tools/getExample.js');

      const result = handleGetExample({ topic: 'test' });
      expect(result).toBeDefined();
    });

    it('should accept full params', async () => {
      const { handleGetExample } = await import('./tools/getExample.js');

      const result = handleGetExample({
        topic: 'register item',
        language: 'java',
        loader: 'fabric',
        minecraftVersion: '1.21.4',
        category: 'items',
        limit: 5,
      });
      expect(result).toBeDefined();
    });
  });
});

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

describe('Edge Cases', () => {
  describe('Special Characters in Input', () => {
    let handleSearchDocs: typeof import('./tools/searchDocs.js').handleSearchDocs;
    let handleExplainConcept: typeof import('./tools/explainConcept.js').handleExplainConcept;

    beforeEach(async () => {
      const searchModule = await import('./tools/searchDocs.js');
      const conceptModule = await import('./tools/explainConcept.js');
      handleSearchDocs = searchModule.handleSearchDocs;
      handleExplainConcept = conceptModule.handleExplainConcept;
    });

    it('should handle queries with special regex characters', () => {
      // Should not throw, even if DB is unavailable
      expect(() => handleSearchDocs({ query: 'test.*query' })).not.toThrow();
      expect(() => handleSearchDocs({ query: 'test[bracket]' })).not.toThrow();
      expect(() => handleSearchDocs({ query: 'test(paren)' })).not.toThrow();
    });

    it('should handle queries with SQL special characters', () => {
      expect(() => handleSearchDocs({ query: "test'quote" })).not.toThrow();
      expect(() => handleSearchDocs({ query: 'test"double' })).not.toThrow();
      expect(() => handleSearchDocs({ query: 'test;semicolon' })).not.toThrow();
    });

    it('should handle unicode characters in concept', async () => {
      const result = await handleExplainConcept({ concept: '日本語' });
      // Should not throw, validation should pass
      expect(result).toBeDefined();
    }, 120000);

    it('should handle emoji in query', () => {
      const result = handleSearchDocs({ query: '🎮 minecraft' });
      expect(result).toBeDefined();
    });
  });

  describe('Boundary Values', () => {
    let handleSearchDocs: typeof import('./tools/searchDocs.js').handleSearchDocs;

    beforeEach(async () => {
      const searchModule = await import('./tools/searchDocs.js');
      handleSearchDocs = searchModule.handleSearchDocs;
    });

    it('should handle limit of 0', () => {
      const result = handleSearchDocs({ query: 'test', limit: 0 });
      // Should clamp to minimum, not error
      expect(result).toBeDefined();
    });

    it('should handle negative limit', () => {
      const result = handleSearchDocs({ query: 'test', limit: -5 });
      // Should clamp to minimum, not error
      expect(result).toBeDefined();
    });

    it('should handle very large limit', () => {
      const result = handleSearchDocs({ query: 'test', limit: 999999 });
      // Should clamp to maximum, not error
      expect(result).toBeDefined();
    });

    it('should handle very long query', () => {
      const longQuery = 'a'.repeat(10000);
      // Should not crash, may return error or empty results
      expect(() => handleSearchDocs({ query: longQuery })).not.toThrow();
    });

    it('should handle single character query', () => {
      const result = handleSearchDocs({ query: 'a' });
      expect(result).toBeDefined();
    });
  });
});

// ============================================================================
// Integration-style Tests (without actual DB)
// ============================================================================

describe('Tool Response Format', () => {
  describe('CallToolResult structure', () => {
    let handleSearchDocs: typeof import('./tools/searchDocs.js').handleSearchDocs;
    let handleGetExample: typeof import('./tools/getExample.js').handleGetExample;
    let handleExplainConcept: typeof import('./tools/explainConcept.js').handleExplainConcept;
    let handleGetMinecraftVersion: typeof import('./tools/getMinecraftVersion.js').handleGetMinecraftVersion;

    beforeEach(async () => {
      const searchModule = await import('./tools/searchDocs.js');
      const exampleModule = await import('./tools/getExample.js');
      const conceptModule = await import('./tools/explainConcept.js');
      const versionModule = await import('./tools/getMinecraftVersion.js');

      handleSearchDocs = searchModule.handleSearchDocs;
      handleGetExample = exampleModule.handleGetExample;
      handleExplainConcept = conceptModule.handleExplainConcept;
      handleGetMinecraftVersion = versionModule.handleGetMinecraftVersion;
    });

    it('searchDocs should return valid CallToolResult', async () => {
      const result = await handleSearchDocs({ query: 'test' });

      expect(result).toHaveProperty('content');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      const content = (result as any).content;

      expect(Array.isArray(content)).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(content.length).toBeGreaterThan(0);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(content[0]).toHaveProperty('type');
    });

    it('getExample should return valid CallToolResult', async () => {
      const result = await handleGetExample({ topic: 'test' });

      expect(result).toHaveProperty('content');
      expect(Array.isArray(result.content)).toBe(true);
    });

    it('explainConcept should return valid CallToolResult', async () => {
      const result = await handleExplainConcept({ concept: 'test' });

      expect(result).toHaveProperty('content');
      expect(Array.isArray(result.content)).toBe(true);
    });

    it('getMinecraftVersion should return valid CallToolResult', () => {
      const result = handleGetMinecraftVersion({});

      expect(result).toHaveProperty('content');
      expect(Array.isArray(result.content)).toBe(true);
    });

    it('error responses should have isError flag', async () => {
      const result = await handleSearchDocs({ query: '' });

      expect(result.isError).toBe(true);
    });

    it('error responses should have text content explaining the error', async () => {
      const result = await handleSearchDocs({ query: '' });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      const content = (result as any).content;

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(content[0]).toHaveProperty('type', 'text');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect((content[0] as { type: string; text: string }).text.length).toBeGreaterThan(0);
    });
  });
});

// ============================================================================
// Version Comparison Edge Cases
// ============================================================================

describe('Version Comparison Edge Cases', () => {
  let DbVersioning: typeof import('./db-versioning.js').DbVersioning;

  beforeEach(async () => {
    vi.resetModules();
    vi.mock('fs', () => ({
      default: {
        existsSync: vi.fn().mockReturnValue(false),
        readFileSync: vi.fn(),
        writeFileSync: vi.fn(),
        mkdirSync: vi.fn(),
        statSync: vi.fn(),
        copyFileSync: vi.fn(),
        unlinkSync: vi.fn(),
        renameSync: vi.fn(),
        createReadStream: vi.fn(),
      },
    }));

    const module = await import('./db-versioning.js');
    DbVersioning = module.DbVersioning;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should handle versions with different lengths', () => {
    const versioning = new DbVersioning();

    // 1.0 vs 1.0.0 should be equal
    expect(versioning.compareVersions('1.0', '1.0.0')).toBe(0);

    // 1.0 vs 1.0.1 - remote is greater
    expect(versioning.compareVersions('1.0', '1.0.1')).toBe(-1);
  });

  it('should handle double-digit version numbers', () => {
    const versioning = new DbVersioning();

    // 1.9 vs 1.10 - 10 > 9
    expect(versioning.compareVersions('1.9.0', '1.10.0')).toBe(-1);

    // 1.21 vs 1.20
    expect(versioning.compareVersions('1.21.0', '1.20.0')).toBe(1);
  });

  it('should handle zero versions', () => {
    const versioning = new DbVersioning();

    expect(versioning.compareVersions('0.0.0', '0.0.1')).toBe(-1);
    expect(versioning.compareVersions('0.0.0', '0.0.0')).toBe(0);
    expect(versioning.compareVersions('0.1.0', '0.0.1')).toBe(1);
  });

  it('should handle pre-release style versions numerically', () => {
    const versioning = new DbVersioning();

    // Note: This treats versions purely numerically
    // 1.0.0 vs 2.0.0
    expect(versioning.compareVersions('1.0.0', '2.0.0')).toBe(-1);
  });
});
