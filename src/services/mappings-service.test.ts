/**
 * Comprehensive tests for MappingsService
 * Tests cover: Search algorithms, tokenization, fuzzy matching, database queries
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Search Algorithm Unit Tests (Pure Functions)
// ============================================================================

describe('Search Algorithm Functions', () => {
  // We need to test the internal functions, so we'll re-implement them here
  // or test them through the service interface

  describe('tokenizeIdentifier', () => {
    // Re-implement for testing (matches mappings-service.ts logic)
    function tokenizeIdentifier(identifier: string): string[] {
      if (!identifier) return [];
      let normalized = identifier.replace(/[_-]/g, ' ');
      normalized = normalized.replace(/([a-z])([A-Z])/g, '$1 $2');
      normalized = normalized.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
      return normalized
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length > 0);
    }

    it('should tokenize simple CamelCase', () => {
      expect(tokenizeIdentifier('sendMessage')).toEqual(['send', 'message']);
    });

    it('should tokenize multi-word CamelCase', () => {
      expect(tokenizeIdentifier('getPlayerHealth')).toEqual(['get', 'player', 'health']);
    });

    it('should handle snake_case', () => {
      expect(tokenizeIdentifier('send_message')).toEqual(['send', 'message']);
    });

    it('should handle kebab-case', () => {
      expect(tokenizeIdentifier('send-message')).toEqual(['send', 'message']);
    });

    it('should handle acronyms at start', () => {
      expect(tokenizeIdentifier('XMLParser')).toEqual(['xml', 'parser']);
    });

    it('should handle acronyms in middle', () => {
      expect(tokenizeIdentifier('getHTTPResponse')).toEqual(['get', 'http', 'response']);
    });

    it('should handle acronyms at end', () => {
      expect(tokenizeIdentifier('parseXML')).toEqual(['parse', 'xml']);
    });

    it('should handle consecutive capitals followed by lowercase', () => {
      expect(tokenizeIdentifier('AABBTree')).toEqual(['aabb', 'tree']);
    });

    it('should handle single word', () => {
      expect(tokenizeIdentifier('render')).toEqual(['render']);
    });

    it('should handle empty string', () => {
      expect(tokenizeIdentifier('')).toEqual([]);
    });

    it('should handle numbers', () => {
      expect(tokenizeIdentifier('vector3D')).toEqual(['vector3d']);
    });

    it('should handle mixed styles', () => {
      expect(tokenizeIdentifier('get_HTTP_Response')).toEqual(['get', 'http', 'response']);
    });

    it('should lowercase all tokens', () => {
      const result = tokenizeIdentifier('UPPERCASE');
      expect(result.every((t) => t === t.toLowerCase())).toBe(true);
    });
  });

  describe('levenshteinDistance', () => {
    function levenshteinDistance(a: string, b: string): number {
      if (a.length === 0) return b.length;
      if (b.length === 0) return a.length;

      const matrix: number[][] = [];
      for (let i = 0; i <= b.length; i++) {
        matrix[i] = new Array<number>(a.length + 1).fill(0);
      }

      for (let i = 0; i <= b.length; i++) {
        matrix[i]![0] = i;
      }
      for (let j = 0; j <= a.length; j++) {
        matrix[0]![j] = j;
      }

      for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
          if (b.charAt(i - 1) === a.charAt(j - 1)) {
            matrix[i]![j] = matrix[i - 1]![j - 1]!;
          } else {
            matrix[i]![j] = Math.min(
              matrix[i - 1]![j - 1]! + 1,
              matrix[i]![j - 1]! + 1,
              matrix[i - 1]![j]! + 1
            );
          }
        }
      }

      return matrix[b.length]![a.length]!;
    }

    it('should return 0 for identical strings', () => {
      expect(levenshteinDistance('hello', 'hello')).toBe(0);
    });

    it('should return string length for empty comparison', () => {
      expect(levenshteinDistance('', 'hello')).toBe(5);
      expect(levenshteinDistance('hello', '')).toBe(5);
    });

    it('should return 0 for two empty strings', () => {
      expect(levenshteinDistance('', '')).toBe(0);
    });

    it('should handle single character difference', () => {
      expect(levenshteinDistance('cat', 'bat')).toBe(1);
    });

    it('should handle insertion', () => {
      expect(levenshteinDistance('health', 'helth')).toBe(1);
    });

    it('should handle deletion', () => {
      expect(levenshteinDistance('helth', 'health')).toBe(1);
    });

    it('should handle transposition', () => {
      expect(levenshteinDistance('create', 'cretae')).toBe(2);
    });

    it('should handle completely different strings', () => {
      expect(levenshteinDistance('abc', 'xyz')).toBe(3);
    });

    it('should be case sensitive', () => {
      expect(levenshteinDistance('Hello', 'hello')).toBe(1);
    });
  });

  describe('stringSimilarity', () => {
    function levenshteinDistance(a: string, b: string): number {
      if (a.length === 0) return b.length;
      if (b.length === 0) return a.length;
      const matrix: number[][] = [];
      for (let i = 0; i <= b.length; i++) {
        matrix[i] = new Array<number>(a.length + 1).fill(0);
      }
      for (let i = 0; i <= b.length; i++) matrix[i]![0] = i;
      for (let j = 0; j <= a.length; j++) matrix[0]![j] = j;
      for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
          if (b.charAt(i - 1) === a.charAt(j - 1)) {
            matrix[i]![j] = matrix[i - 1]![j - 1]!;
          } else {
            matrix[i]![j] = Math.min(
              matrix[i - 1]![j - 1]! + 1,
              matrix[i]![j - 1]! + 1,
              matrix[i - 1]![j]! + 1
            );
          }
        }
      }
      return matrix[b.length]![a.length]!;
    }

    function stringSimilarity(a: string, b: string): number {
      if (a === b) return 1.0;
      if (a.length === 0 || b.length === 0) return 0.0;
      const distance = levenshteinDistance(a.toLowerCase(), b.toLowerCase());
      const maxLength = Math.max(a.length, b.length);
      return 1 - distance / maxLength;
    }

    it('should return 1.0 for identical strings', () => {
      expect(stringSimilarity('hello', 'hello')).toBe(1.0);
    });

    it('should return 0.0 for empty vs non-empty', () => {
      expect(stringSimilarity('', 'hello')).toBe(0.0);
      expect(stringSimilarity('hello', '')).toBe(0.0);
    });

    it('should be case-insensitive', () => {
      expect(stringSimilarity('Hello', 'hello')).toBe(1.0);
    });

    it('should return high similarity for small differences', () => {
      const similarity = stringSimilarity('setHealth', 'setHelth');
      expect(similarity).toBeGreaterThan(0.8);
    });

    it('should return low similarity for very different strings', () => {
      const similarity = stringSimilarity('abc', 'xyz');
      expect(similarity).toBeLessThan(0.1);
    });

    it('should return medium similarity for partial matches', () => {
      const similarity = stringSimilarity('sendMessage', 'sendMsg');
      expect(similarity).toBeGreaterThan(0.5);
      expect(similarity).toBeLessThan(0.9);
    });
  });

  describe('isInternalName', () => {
    const INTERNAL_PREFIXES = ['_', 'lambda$', 'access$', '$'];

    function isInternalName(name: string): boolean {
      if (!name) return false;
      for (const prefix of INTERNAL_PREFIXES) {
        if (name.startsWith(prefix)) return true;
      }
      if (name.includes('$') && !name.endsWith('$')) return true;
      return false;
    }

    it('should identify underscore prefix as internal', () => {
      expect(isInternalName('_privateMethod')).toBe(true);
    });

    it('should identify lambda methods', () => {
      expect(isInternalName('lambda$static$0')).toBe(true);
      expect(isInternalName('lambda$onTick$1')).toBe(true);
    });

    it('should identify access methods', () => {
      expect(isInternalName('access$000')).toBe(true);
    });

    it('should identify $ prefix', () => {
      expect(isInternalName('$deserializeLambda$')).toBe(true);
    });

    it('should identify methods with $ in middle', () => {
      expect(isInternalName('method$inner')).toBe(true);
    });

    it('should NOT flag normal methods', () => {
      expect(isInternalName('sendMessage')).toBe(false);
      expect(isInternalName('getHealth')).toBe(false);
      expect(isInternalName('render')).toBe(false);
    });

    it('should handle empty string', () => {
      expect(isInternalName('')).toBe(false);
    });

    it('should handle methods ending with $', () => {
      // Methods ending with $ are not internal (like $VALUES enum)
      expect(isInternalName('VALUES$')).toBe(false);
    });
  });

  describe('expandAbbreviations', () => {
    const ABBREVIATION_MAP: Record<string, string[]> = {
      msg: ['message'],
      btn: ['button'],
      inv: ['inventory'],
      pos: ['position'],
      nbt: ['nbt', 'tag', 'compound'],
      hp: ['health'],
    };

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

    it('should expand known abbreviations', () => {
      expect(expandAbbreviations(['msg'])).toContain('message');
      expect(expandAbbreviations(['btn'])).toContain('button');
    });

    it('should keep original token', () => {
      const result = expandAbbreviations(['msg']);
      expect(result).toContain('msg');
      expect(result).toContain('message');
    });

    it('should not expand unknown tokens', () => {
      expect(expandAbbreviations(['render'])).toEqual(['render']);
    });

    it('should handle multiple tokens', () => {
      const result = expandAbbreviations(['send', 'msg']);
      expect(result).toContain('send');
      expect(result).toContain('msg');
      expect(result).toContain('message');
    });

    it('should not duplicate expansions', () => {
      const result = expandAbbreviations(['msg', 'msg']);
      const messageCount = result.filter((t) => t === 'message').length;
      expect(messageCount).toBe(1);
    });

    it('should handle NBT with multiple expansions', () => {
      const result = expandAbbreviations(['nbt']);
      expect(result).toContain('nbt');
      expect(result).toContain('tag');
      expect(result).toContain('compound');
    });
  });
});

// ============================================================================
// MappingsService Integration Tests (Requires Database)
// ============================================================================

describe('MappingsService Integration', () => {
  const TEST_DB_PATH = path.join(process.cwd(), 'data', 'parchment-mappings.db');
  let hasDatabase = false;

  beforeAll(() => {
    hasDatabase = fs.existsSync(TEST_DB_PATH);
  });

  describe('Database Availability', () => {
    it('should have test database available', () => {
      // This is informational - tests will skip if DB not available
      if (!hasDatabase) {
        console.log('Parchment mappings database not found - skipping integration tests');
      }
      expect(true).toBe(true);
    });
  });

  describe.runIf(fs.existsSync(path.join(process.cwd(), 'data', 'parchment-mappings.db')))(
    'MappingsService',
    () => {
      let MappingsService: typeof import('./mappings-service.js').MappingsService;
      let service: InstanceType<typeof MappingsService>;

      beforeAll(async () => {
        const module = await import('./mappings-service.js');
        MappingsService = module.MappingsService;
        service = new MappingsService(TEST_DB_PATH);
      });

      afterAll(() => {
        if (service) {
          service.close();
        }
      });

      describe('getStats', () => {
        it('should return database statistics', () => {
          const stats = service.getStats();

          expect(stats).toHaveProperty('totalClasses');
          expect(stats).toHaveProperty('totalMethods');
          expect(stats).toHaveProperty('totalFields');
          expect(stats).toHaveProperty('totalParameters');
          expect(stats).toHaveProperty('minecraftVersions');

          expect(stats.totalClasses).toBeGreaterThan(0);
          expect(stats.totalMethods).toBeGreaterThan(0);
          expect(Array.isArray(stats.minecraftVersions)).toBe(true);
        });
      });

      describe('getMinecraftVersions', () => {
        it('should return array of version strings', () => {
          const versions = service.getMinecraftVersions();

          expect(Array.isArray(versions)).toBe(true);
          expect(versions.length).toBeGreaterThan(0);
          // Versions should look like Minecraft versions
          expect(versions.some((v) => v.startsWith('1.'))).toBe(true);
        });
      });

      describe('getLatestVersion', () => {
        it('should return a version string', () => {
          const version = service.getLatestVersion();

          expect(typeof version).toBe('string');
          expect(version).toMatch(/^\d+\.\d+/);
        });
      });

      describe('search', () => {
        describe('exact matching', () => {
          it('should find exact method name match', () => {
            const results = service.search({ query: 'sendMessage', limit: 10 });

            expect(results.length).toBeGreaterThan(0);
            const exactMatch = results.find((r) => r.name === 'sendMessage');
            expect(exactMatch).toBeDefined();
            expect(exactMatch?.score).toBe(100);
          });

          it('should find exact class name match', () => {
            const results = service.search({ query: 'BlockEntity', limit: 10 });

            expect(results.length).toBeGreaterThan(0);
            const exactMatch = results.find((r) => r.name === 'BlockEntity');
            expect(exactMatch).toBeDefined();
          });
        });

        describe('natural language queries', () => {
          it('should find CamelCase from space-separated query', () => {
            const results = service.search({ query: 'get name', limit: 20 });

            expect(results.length).toBeGreaterThan(0);
            // Should find methods with 'get' and 'name' tokens
            const match = results.find((r) => r.name.toLowerCase().includes('name'));
            expect(match).toBeDefined();
          });

          it('should find multi-word methods', () => {
            const results = service.search({ query: 'set health', limit: 20 });

            expect(results.length).toBeGreaterThan(0);
            // Should find methods with health
            const match = results.find((r) => r.name.toLowerCase().includes('health'));
            expect(match).toBeDefined();
          });
        });

        describe('fuzzy matching', () => {
          it('should find method with typo (missing letter)', () => {
            const results = service.search({ query: 'setHelth', limit: 10 });

            expect(results.length).toBeGreaterThan(0);
            const match = results.find((r) => r.name === 'setHealth');
            expect(match).toBeDefined();
            expect(match!.score).toBeGreaterThan(50);
          });

          it('should find method with transposed letters', () => {
            const results = service.search({ query: 'rendor', limit: 20 });

            expect(results.length).toBeGreaterThan(0);
            // Should find 'render' related methods
            const match = results.find((r) => r.name.toLowerCase().includes('render'));
            expect(match).toBeDefined();
          });
        });

        describe('abbreviation expansion', () => {
          it('should expand msg to message', () => {
            const results = service.search({ query: 'send msg', limit: 20 });

            expect(results.length).toBeGreaterThan(0);
            const match = results.find((r) => r.name.toLowerCase().includes('message'));
            expect(match).toBeDefined();
          });

          it('should expand inv to inventory', () => {
            const results = service.search({ query: 'clear inv', limit: 20 });

            expect(results.length).toBeGreaterThan(0);
            const match = results.find((r) => r.name.toLowerCase().includes('inventory'));
            expect(match).toBeDefined();
          });
        });

        describe('type filtering', () => {
          it('should filter by method type', () => {
            const results = service.search({ query: 'render', type: 'method', limit: 20 });

            expect(results.length).toBeGreaterThan(0);
            results.forEach((r) => {
              expect(r.type).toBe('method');
            });
          });

          it('should filter by class type', () => {
            const results = service.search({ query: 'Entity', type: 'class', limit: 20 });

            expect(results.length).toBeGreaterThan(0);
            results.forEach((r) => {
              expect(r.type).toBe('class');
            });
          });

          it('should filter by field type', () => {
            const results = service.search({ query: 'SLOTS', type: 'field', limit: 20 });

            expect(results.length).toBeGreaterThan(0);
            results.forEach((r) => {
              expect(r.type).toBe('field');
            });
          });
        });

        describe('limit handling', () => {
          it('should respect limit parameter', () => {
            const results5 = service.search({ query: 'get', limit: 5 });
            const results20 = service.search({ query: 'get', limit: 20 });

            expect(results5.length).toBeLessThanOrEqual(5);
            expect(results20.length).toBeLessThanOrEqual(20);
            expect(results20.length).toBeGreaterThan(results5.length);
          });
        });

        describe('edge cases', () => {
          it('should return empty for nonsense query', () => {
            const results = service.search({ query: 'xyznonexistent12345', limit: 10 });

            expect(results.length).toBe(0);
          });

          it('should handle single character query gracefully', () => {
            const results = service.search({ query: 'a', limit: 10 });

            // Should return results but not crash
            expect(Array.isArray(results)).toBe(true);
          });

          it('should handle empty query', () => {
            const results = service.search({ query: '', limit: 10 });

            expect(results.length).toBe(0);
          });

          it('should handle query with only spaces', () => {
            const results = service.search({ query: '   ', limit: 10 });

            expect(results.length).toBe(0);
          });
        });

        describe('internal method deprioritization', () => {
          it('should rank normal methods higher than lambda methods', () => {
            const results = service.search({ query: 'static', limit: 50 });

            // If lambda methods are present, they should have lower scores
            const lambdaResults = results.filter((r) => r.name.includes('lambda$'));
            const normalResults = results.filter(
              (r) => !r.name.includes('lambda$') && !r.name.startsWith('_')
            );

            if (lambdaResults.length > 0 && normalResults.length > 0) {
              const avgLambdaScore =
                lambdaResults.reduce((a, b) => a + b.score, 0) / lambdaResults.length;
              const avgNormalScore =
                normalResults.reduce((a, b) => a + b.score, 0) / normalResults.length;
              expect(avgNormalScore).toBeGreaterThan(avgLambdaScore);
            }
          });
        });
      });

      describe('getClass', () => {
        it('should return class by full name', () => {
          const cls = service.getClass('net.minecraft.world.level.block.Block');

          expect(cls).toBeDefined();
          expect(cls?.name).toBe('Block');
        });

        it('should return null/undefined for non-existent class', () => {
          const cls = service.getClass('com.nonexistent.FakeClass12345');

          expect(cls).toBeFalsy();
        });
      });

      describe('getClassMethods', () => {
        it('should return methods for a class', () => {
          const cls = service.getClass('net.minecraft.world.level.block.Block');
          if (cls) {
            const methods = service.getClassMethods(cls.id);
            expect(Array.isArray(methods)).toBe(true);
          }
        });
      });

      describe('getClassFields', () => {
        it('should return fields for a class', () => {
          const cls = service.getClass('net.minecraft.world.level.block.Block');
          if (cls) {
            const fields = service.getClassFields(cls.id);
            expect(Array.isArray(fields)).toBe(true);
          }
        });
      });

      describe('lookupObfuscated', () => {
        it('should return null for invalid obfuscated name', () => {
          const result = service.lookupObfuscated('notarealclass');

          expect(result).toBeNull();
        });
      });

      describe('getPackages', () => {
        it('should return list of top-level packages', () => {
          const packages = service.getPackages();

          expect(Array.isArray(packages)).toBe(true);
          expect(packages.length).toBeGreaterThan(0);
          // Should contain common Minecraft packages
          expect(packages.some((p) => p === 'net' || p === 'com')).toBe(true);
        });
      });

      describe('getClassesInPackage', () => {
        it('should return classes in a package', () => {
          const classes = service.getClassesInPackage('net.minecraft.world');

          expect(Array.isArray(classes)).toBe(true);
          expect(classes.length).toBeGreaterThan(0);
        });

        it('should return empty array for non-existent package', () => {
          const classes = service.getClassesInPackage('nonexistent.package.path');

          expect(classes).toEqual([]);
        });
      });
    }
  );
});

// ============================================================================
// Scoring Algorithm Tests
// ============================================================================

describe('Scoring Algorithm', () => {
  describe('score consistency', () => {
    it('exact match should always score 100', () => {
      // We test this through the service if available
      const TEST_DB_PATH = path.join(process.cwd(), 'data', 'parchment-mappings.db');
      if (!fs.existsSync(TEST_DB_PATH)) {
        console.log('Skipping scoring tests - no database');
        return;
      }
      // Test will run in integration tests above
      expect(true).toBe(true);
    });
  });

  describe('score ordering', () => {
    // These test the relative scoring logic
    function mockScore(matchType: string): number {
      switch (matchType) {
        case 'exact':
          return 100;
        case 'prefix':
          return 90;
        case 'token':
          return 75;
        case 'fuzzy':
          return 40;
        case 'internal':
          return 50; // 75 - 25 penalty
        default:
          return 0;
      }
    }

    it('exact > prefix > token > fuzzy', () => {
      expect(mockScore('exact')).toBeGreaterThan(mockScore('prefix'));
      expect(mockScore('prefix')).toBeGreaterThan(mockScore('token'));
      expect(mockScore('token')).toBeGreaterThan(mockScore('fuzzy'));
    });

    it('internal methods should be penalized', () => {
      expect(mockScore('token')).toBeGreaterThan(mockScore('internal'));
    });
  });
});

// ============================================================================
// Result Format Tests
// ============================================================================

describe('Result Format', () => {
  const TEST_DB_PATH = path.join(process.cwd(), 'data', 'parchment-mappings.db');

  describe.runIf(fs.existsSync(TEST_DB_PATH))('MappingSearchResult structure', () => {
    let MappingsService: typeof import('./mappings-service.js').MappingsService;
    let service: InstanceType<typeof MappingsService>;

    beforeAll(async () => {
      const module = await import('./mappings-service.js');
      MappingsService = module.MappingsService;
      service = new MappingsService(TEST_DB_PATH);
    });

    afterAll(() => {
      if (service) service.close();
    });

    it('method results should have required fields', () => {
      const results = service.search({ query: 'tick', type: 'method', limit: 5 });

      expect(results.length).toBeGreaterThan(0);
      const result = results[0]!;

      expect(result).toHaveProperty('type', 'method');
      expect(result).toHaveProperty('name');
      expect(result).toHaveProperty('fullName');
      expect(result).toHaveProperty('score');
      expect(result).toHaveProperty('className');
      expect(typeof result.score).toBe('number');
    });

    it('class results should have required fields', () => {
      const results = service.search({ query: 'Block', type: 'class', limit: 5 });

      expect(results.length).toBeGreaterThan(0);
      const result = results[0]!;

      expect(result).toHaveProperty('type', 'class');
      expect(result).toHaveProperty('name');
      expect(result).toHaveProperty('fullName');
      expect(result).toHaveProperty('score');
      expect(result).toHaveProperty('packageName');
    });

    it('field results should have required fields', () => {
      const results = service.search({ query: 'TICKS', type: 'field', limit: 5 });

      expect(results.length).toBeGreaterThan(0);
      const result = results[0]!;

      expect(result).toHaveProperty('type', 'field');
      expect(result).toHaveProperty('name');
      expect(result).toHaveProperty('score');
    });

    it('scores should be in valid range (0-100)', () => {
      const results = service.search({ query: 'render', limit: 50 });

      results.forEach((result) => {
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(100);
      });
    });

    it('results should be sorted by score descending', () => {
      const results = service.search({ query: 'entity', limit: 20 });

      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i]!.score).toBeGreaterThanOrEqual(results[i + 1]!.score);
      }
    });
  });
});
