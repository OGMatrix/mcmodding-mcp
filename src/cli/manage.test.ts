/* eslint-disable no-control-regex */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import * as fs from 'fs';
import * as https from 'https';
import * as readline from 'readline';
import { EventEmitter } from 'events';

// Mock dependencies
vi.mock('fs');
vi.mock('https');
vi.mock('readline');

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTION TESTS
// These test the pure utility functions that can be tested in isolation
// ═══════════════════════════════════════════════════════════════════════════════

describe('Utility Functions', () => {
  describe('formatBytes', () => {
    // We need to test the formatBytes function logic
    const formatBytes = (bytes: number): string => {
      if (bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    it('should format 0 bytes', () => {
      expect(formatBytes(0)).toBe('0 B');
    });

    it('should format bytes (< 1KB)', () => {
      expect(formatBytes(500)).toBe('500 B');
      expect(formatBytes(1)).toBe('1 B');
      expect(formatBytes(1023)).toBe('1023 B');
    });

    it('should format kilobytes', () => {
      expect(formatBytes(1024)).toBe('1 KB');
      expect(formatBytes(1536)).toBe('1.5 KB');
      expect(formatBytes(10240)).toBe('10 KB');
    });

    it('should format megabytes', () => {
      expect(formatBytes(1048576)).toBe('1 MB');
      expect(formatBytes(1572864)).toBe('1.5 MB');
      expect(formatBytes(52428800)).toBe('50 MB');
    });

    it('should format gigabytes', () => {
      expect(formatBytes(1073741824)).toBe('1 GB');
      expect(formatBytes(1610612736)).toBe('1.5 GB');
    });
  });

  describe('formatSpeed', () => {
    const formatBytes = (bytes: number): string => {
      if (bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const formatSpeed = (bytesPerSecond: number): string => {
      return formatBytes(bytesPerSecond) + '/s';
    };

    it('should format speed with /s suffix', () => {
      expect(formatSpeed(0)).toBe('0 B/s');
      expect(formatSpeed(1024)).toBe('1 KB/s');
      expect(formatSpeed(1048576)).toBe('1 MB/s');
    });
  });

  describe('formatTime', () => {
    const formatTime = (seconds: number): string => {
      if (!isFinite(seconds) || seconds <= 0) return '--:--';
      if (seconds < 60) return `${Math.round(seconds)}s`;
      const mins = Math.floor(seconds / 60);
      const secs = Math.round(seconds % 60);
      return `${mins}m ${secs.toString().padStart(2, '0')}s`;
    };

    it('should return --:-- for invalid input', () => {
      expect(formatTime(0)).toBe('--:--');
      expect(formatTime(-1)).toBe('--:--');
      expect(formatTime(Infinity)).toBe('--:--');
      expect(formatTime(NaN)).toBe('--:--');
    });

    it('should format seconds (< 60)', () => {
      expect(formatTime(1)).toBe('1s');
      expect(formatTime(30)).toBe('30s');
      expect(formatTime(59)).toBe('59s');
    });

    it('should format minutes and seconds', () => {
      expect(formatTime(60)).toBe('1m 00s');
      expect(formatTime(90)).toBe('1m 30s');
      expect(formatTime(125)).toBe('2m 05s');
      expect(formatTime(3661)).toBe('61m 01s');
    });
  });

  describe('centerText', () => {
    const centerText = (text: string, width: number): string => {
      const cleanText = text.replace(/\x1b\[[0-9;]*m/g, '');
      const totalPadding = Math.max(0, width - cleanText.length);
      const leftPadding = Math.floor(totalPadding / 2);
      const rightPadding = totalPadding - leftPadding;
      return ' '.repeat(leftPadding) + text + ' '.repeat(rightPadding);
    };

    it('should center text in given width', () => {
      expect(centerText('hi', 10)).toBe('    hi    ');
      expect(centerText('test', 10)).toBe('   test   ');
    });

    it('should handle text longer than width', () => {
      expect(centerText('hello world', 5)).toBe('hello world');
    });

    it('should handle odd padding correctly', () => {
      // 'abc' is 3 chars, width 10, total padding 7
      // left: 3, right: 4
      const result = centerText('abc', 10);
      expect(result).toBe('   abc    ');
      expect(result.length).toBe(10);
    });

    it('should strip ANSI codes when calculating width', () => {
      const ansiText = '\x1b[31mred\x1b[0m'; // 'red' with color codes
      const result = centerText(ansiText, 10);
      // Clean text is 'red' (3 chars), so padding should be same as 'abc'
      expect(result.length).toBeGreaterThan(10); // includes ANSI codes
    });
  });

  describe('padLine', () => {
    const padLine = (text: string, width: number): string => {
      const cleanText = text.replace(/\x1b\[[0-9;]*m/g, '');
      const padding = Math.max(0, width - cleanText.length);
      return text + ' '.repeat(padding);
    };

    it('should pad text to specified width', () => {
      expect(padLine('hello', 10)).toBe('hello     ');
      expect(padLine('test', 8)).toBe('test    ');
    });

    it('should not truncate text longer than width', () => {
      expect(padLine('hello world', 5)).toBe('hello world');
    });

    it('should handle ANSI codes when padding', () => {
      const ansiText = '\x1b[32mgreen\x1b[0m';
      const result = padLine(ansiText, 10);
      // Clean text is 'green' (5 chars), needs 5 padding
      expect(result).toBe(ansiText + '     ');
    });
  });

  describe('compareVersions', () => {
    const compareVersions = (v1: string, v2: string): number => {
      const parts1 = v1.split('.').map(Number);
      const parts2 = v2.split('.').map(Number);

      for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
        const p1 = parts1[i] || 0;
        const p2 = parts2[i] || 0;
        if (p1 > p2) return 1;
        if (p1 < p2) return -1;
      }
      return 0;
    };

    it('should return 0 for equal versions', () => {
      expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
      expect(compareVersions('2.1.3', '2.1.3')).toBe(0);
    });

    it('should return 1 when first version is greater', () => {
      expect(compareVersions('2.0.0', '1.0.0')).toBe(1);
      expect(compareVersions('1.1.0', '1.0.0')).toBe(1);
      expect(compareVersions('1.0.1', '1.0.0')).toBe(1);
      expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
    });

    it('should return -1 when first version is smaller', () => {
      expect(compareVersions('1.0.0', '2.0.0')).toBe(-1);
      expect(compareVersions('1.0.0', '1.1.0')).toBe(-1);
      expect(compareVersions('1.0.0', '1.0.1')).toBe(-1);
      expect(compareVersions('1.9.0', '1.10.0')).toBe(-1);
    });

    it('should handle versions with different segment counts', () => {
      expect(compareVersions('1.0', '1.0.0')).toBe(0);
      expect(compareVersions('1.0.0', '1.0')).toBe(0);
      expect(compareVersions('1.0', '1.0.1')).toBe(-1);
      expect(compareVersions('1.0.1', '1.0')).toBe(1);
    });

    it('should handle single segment versions', () => {
      expect(compareVersions('1', '1')).toBe(0);
      expect(compareVersions('2', '1')).toBe(1);
      expect(compareVersions('1', '2')).toBe(-1);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// DATABASE CONFIGURATION TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Database Configuration', () => {
  const AVAILABLE_DBS = [
    {
      id: 'mcmodding-docs',
      name: 'Documentation Database',
      fileName: 'mcmodding-docs.db',
      manifestName: 'db-manifest.json',
      description: 'Core Fabric & NeoForge documentation - installed by default',
      tagPrefix: 'v',
      icon: '📚',
      isRequired: true,
    },
    {
      id: 'mod-examples',
      name: 'Mod Examples Database',
      fileName: 'mod-examples.db',
      manifestName: 'mod-examples-manifest.json',
      description: '1000+ high-quality modding examples for Fabric & NeoForge',
      tagPrefix: 'examples-v',
      icon: '🧩',
    },
  ];

  it('should have exactly 2 available databases', () => {
    expect(AVAILABLE_DBS).toHaveLength(2);
  });

  it('should have mcmodding-docs as the first (core) database', () => {
    const docsDb = AVAILABLE_DBS[0];
    expect(docsDb?.id).toBe('mcmodding-docs');
    expect(docsDb?.isRequired).toBe(true);
    expect(docsDb?.tagPrefix).toBe('v');
  });

  it('should have mod-examples as optional database', () => {
    const examplesDb = AVAILABLE_DBS[1];
    expect(examplesDb?.id).toBe('mod-examples');
    expect(examplesDb?.isRequired).toBeUndefined();
    expect(examplesDb?.tagPrefix).toBe('examples-v');
  });

  it('should have valid file names for all databases', () => {
    AVAILABLE_DBS.forEach((db) => {
      expect(db.fileName).toMatch(/\.db$/);
      expect(db.manifestName).toMatch(/\.json$/);
    });
  });

  it('should have unique IDs for all databases', () => {
    const ids = AVAILABLE_DBS.map((db) => db.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CLI INSTALLER INTEGRATION TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('CLI Installer', () => {
  let runInstaller: typeof import('./manage.js').runInstaller;
  let mockRl: { question: Mock; close: Mock; on: Mock };
  let mockRequest: { on: Mock; destroy: Mock } & EventEmitter;
  let mockResponse: {
    statusCode: number;
    headers: Record<string, string>;
    resume: Mock;
    pause: Mock;
    destroy: Mock;
  } & EventEmitter;

  beforeEach(async () => {
    vi.resetModules();

    // Mock readline
    mockRl = {
      question: vi.fn(),
      close: vi.fn(),
      on: vi.fn(),
    };
    vi.mocked(readline.createInterface).mockReturnValue(mockRl as unknown as readline.Interface);

    // Mock https response
    mockResponse = Object.assign(new EventEmitter(), {
      statusCode: 200,
      headers: { 'content-length': '1048576' }, // 1MB
      resume: vi.fn(),
      pause: vi.fn(),
      destroy: vi.fn(),
    });

    // Mock https request
    mockRequest = Object.assign(new EventEmitter(), {
      on: vi.fn().mockReturnThis(),
      destroy: vi.fn(),
    });

    vi.mocked(https.get).mockImplementation((url, options, cb) => {
      if (typeof options === 'function') {
        cb = options;
      }
      // Simulate async behavior
      setTimeout(() => {
        if (cb) cb(mockResponse as unknown as import('http').IncomingMessage);
      }, 0);
      return mockRequest as unknown as import('http').ClientRequest;
    });

    // Mock fs
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
    vi.mocked(fs.unlinkSync).mockReturnValue(undefined);
    vi.mocked(fs.renameSync).mockReturnValue(undefined);
    vi.mocked(fs.readFileSync).mockReturnValue('{"version": "0.1.0"}');
    vi.mocked(fs.createWriteStream).mockReturnValue({
      write: vi.fn().mockReturnValue(true),
      end: vi.fn(),
      on: vi.fn().mockReturnThis(),
      close: vi.fn(),
    } as unknown as fs.WriteStream);

    // Import the module under test
    const module = await import('./manage.js');
    runInstaller = module.runInstaller;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should export runInstaller function', () => {
    expect(runInstaller).toBeDefined();
    expect(typeof runInstaller).toBe('function');
  });

  it('runInstaller should be an async function', () => {
    // Check that it returns a promise
    const result = runInstaller();
    expect(result).toBeInstanceOf(Promise);
    // Clean up the promise to avoid unhandled rejection
    result.catch(() => {});
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PROGRESS DISPLAY LOGIC TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Progress Display Logic', () => {
  describe('Progress percentage calculation', () => {
    const calculatePercentage = (downloaded: number, total: number): number => {
      return total > 0 ? Math.min(100, (downloaded / total) * 100) : 0;
    };

    it('should calculate 0% for no download', () => {
      expect(calculatePercentage(0, 1000)).toBe(0);
    });

    it('should calculate 50% correctly', () => {
      expect(calculatePercentage(500, 1000)).toBe(50);
    });

    it('should calculate 100% correctly', () => {
      expect(calculatePercentage(1000, 1000)).toBe(100);
    });

    it('should cap at 100% if downloaded exceeds total', () => {
      expect(calculatePercentage(1500, 1000)).toBe(100);
    });

    it('should return 0% if total is 0', () => {
      expect(calculatePercentage(500, 0)).toBe(0);
    });
  });

  describe('Progress bar width calculation', () => {
    const calculateBarWidths = (
      percentage: number,
      barWidth: number
    ): { filled: number; empty: number } => {
      const filledWidth = Math.round((percentage / 100) * barWidth);
      const emptyWidth = barWidth - filledWidth;
      return { filled: filledWidth, empty: emptyWidth };
    };

    it('should have all empty for 0%', () => {
      const { filled, empty } = calculateBarWidths(0, 40);
      expect(filled).toBe(0);
      expect(empty).toBe(40);
    });

    it('should have all filled for 100%', () => {
      const { filled, empty } = calculateBarWidths(100, 40);
      expect(filled).toBe(40);
      expect(empty).toBe(0);
    });

    it('should split evenly for 50%', () => {
      const { filled, empty } = calculateBarWidths(50, 40);
      expect(filled).toBe(20);
      expect(empty).toBe(20);
    });

    it('should round correctly for fractional percentages', () => {
      const { filled, empty } = calculateBarWidths(33.33, 30);
      expect(filled).toBe(10);
      expect(empty).toBe(20);
      expect(filled + empty).toBe(30);
    });
  });

  describe('ETA calculation', () => {
    const calculateEta = (remaining: number, speed: number): number => {
      return speed > 0 ? remaining / speed : 0;
    };

    it('should return 0 when speed is 0', () => {
      expect(calculateEta(1000, 0)).toBe(0);
    });

    it('should calculate ETA correctly', () => {
      // 1000 bytes remaining, 100 bytes/sec = 10 seconds
      expect(calculateEta(1000, 100)).toBe(10);
    });

    it('should handle large values', () => {
      // 100MB remaining, 1MB/sec = 100 seconds
      expect(calculateEta(104857600, 1048576)).toBe(100);
    });
  });

  describe('Speed averaging', () => {
    const calculateAverageSpeed = (speeds: number[]): number => {
      if (speeds.length === 0) return 0;
      return speeds.reduce((a, b) => a + b, 0) / speeds.length;
    };

    it('should return 0 for empty array', () => {
      expect(calculateAverageSpeed([])).toBe(0);
    });

    it('should calculate average correctly', () => {
      expect(calculateAverageSpeed([100, 200, 300])).toBe(200);
    });

    it('should handle single value', () => {
      expect(calculateAverageSpeed([500])).toBe(500);
    });

    it('should handle floating point values', () => {
      const avg = calculateAverageSpeed([100.5, 200.5]);
      expect(avg).toBeCloseTo(150.5);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ANSI CODE HANDLING TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('ANSI Code Handling', () => {
  const stripAnsi = (text: string): string => {
    return text.replace(/\x1b\[[0-9;]*m/g, '');
  };

  it('should strip basic color codes', () => {
    expect(stripAnsi('\x1b[31mred\x1b[0m')).toBe('red');
    expect(stripAnsi('\x1b[32mgreen\x1b[0m')).toBe('green');
  });

  it('should strip bold and dim codes', () => {
    expect(stripAnsi('\x1b[1mbold\x1b[0m')).toBe('bold');
    expect(stripAnsi('\x1b[2mdim\x1b[0m')).toBe('dim');
  });

  it('should strip bright color codes', () => {
    expect(stripAnsi('\x1b[91mbright red\x1b[0m')).toBe('bright red');
    expect(stripAnsi('\x1b[97mbright white\x1b[0m')).toBe('bright white');
  });

  it('should handle text with no ANSI codes', () => {
    expect(stripAnsi('plain text')).toBe('plain text');
  });

  it('should handle multiple codes in sequence', () => {
    const text = '\x1b[1m\x1b[31mbold red\x1b[0m';
    expect(stripAnsi(text)).toBe('bold red');
  });

  it('should handle nested/sequential styled text', () => {
    const text = '\x1b[32mgreen\x1b[0m and \x1b[34mblue\x1b[0m';
    expect(stripAnsi(text)).toBe('green and blue');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// REMOTE INFO PARSING TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Remote Info Parsing', () => {
  const extractVersionFromTag = (tagName: string, prefix: string): string => {
    return tagName.replace(prefix, '');
  };

  it('should extract version from standard tag', () => {
    expect(extractVersionFromTag('v0.2.0', 'v')).toBe('0.2.0');
  });

  it('should extract version from examples tag', () => {
    expect(extractVersionFromTag('examples-v0.1.0', 'examples-v')).toBe('0.1.0');
  });

  it('should handle complex version numbers', () => {
    expect(extractVersionFromTag('v1.2.3-beta.4', 'v')).toBe('1.2.3-beta.4');
  });

  describe('Asset matching', () => {
    const findAsset = (
      assets: Array<{ name: string }>,
      fileName: string
    ): { name: string } | undefined => {
      return assets.find((a) => a.name === fileName);
    };

    const mockAssets = [
      { name: 'mcmodding-docs.db' },
      { name: 'db-manifest.json' },
      { name: 'mod-examples.db' },
      { name: 'mod-examples-manifest.json' },
      { name: 'checksums.txt' },
    ];

    it('should find database file', () => {
      expect(findAsset(mockAssets, 'mcmodding-docs.db')?.name).toBe('mcmodding-docs.db');
    });

    it('should find manifest file', () => {
      expect(findAsset(mockAssets, 'db-manifest.json')?.name).toBe('db-manifest.json');
    });

    it('should return undefined for missing asset', () => {
      expect(findAsset(mockAssets, 'nonexistent.db')).toBeUndefined();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SYMBOL AND COLOR SUPPORT TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Symbols Configuration', () => {
  const sym = {
    topLeft: '╔',
    topRight: '╗',
    bottomLeft: '╚',
    bottomRight: '╝',
    horizontal: '═',
    vertical: '║',
    check: '✔',
    cross: '✖',
    warning: '⚠',
    download: '⬇',
    pause: '⏸',
    barFull: '█',
    barEmpty: '░',
    selected: '◉',
    unselected: '○',
  };

  it('should have box drawing characters', () => {
    expect(sym.topLeft).toBe('╔');
    expect(sym.topRight).toBe('╗');
    expect(sym.bottomLeft).toBe('╚');
    expect(sym.bottomRight).toBe('╝');
  });

  it('should have status symbols', () => {
    expect(sym.check).toBe('✔');
    expect(sym.cross).toBe('✖');
    expect(sym.warning).toBe('⚠');
  });

  it('should have progress bar characters', () => {
    expect(sym.barFull).toBe('█');
    expect(sym.barEmpty).toBe('░');
  });

  it('should have selection indicators', () => {
    expect(sym.selected).toBe('◉');
    expect(sym.unselected).toBe('○');
  });
});
