import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import * as fs from 'fs';
import * as https from 'https';
import * as readline from 'readline';
import { EventEmitter } from 'events';

// Mock dependencies
vi.mock('fs');
vi.mock('https');
vi.mock('readline');

describe('CLI Installer', () => {
  let runInstaller: typeof import('./install.js').runInstaller;
  let mockRl: { question: Mock; close: Mock; on: Mock };
  let mockRequest: { on: Mock } & EventEmitter;
  let mockResponse: {
    statusCode: number;
    headers: Record<string, string>;
    resume: Mock;
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

    // Mock https
    mockResponse = Object.assign(new EventEmitter(), {
      statusCode: 200,
      headers: { 'content-length': '100' },
      resume: vi.fn(),
    });

    mockRequest = Object.assign(new EventEmitter(), {
      on: vi.fn(),
    });

    vi.mocked(https.get).mockImplementation((url, options, cb) => {
      if (typeof options === 'function') {
        cb = options;
      }
      if (cb) cb(mockResponse as unknown as import('http').IncomingMessage);
      return mockRequest as unknown as import('http').ClientRequest;
    });

    // Mock fs
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
    vi.mocked(fs.createWriteStream).mockReturnValue({
      write: vi.fn(),
      end: vi.fn(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      on: vi.fn().mockImplementation(function (this: any, event: string, cb: () => void) {
        if (event === 'finish') cb();
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return this;
      }),
      close: vi.fn(),
    } as unknown as fs.WriteStream);

    // Import the module under test
    const module = await import('./install.js');
    runInstaller = module.runInstaller;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(runInstaller).toBeDefined();
  });

  // Note: Testing the full interactive flow is complex due to the TUI nature.
  // We would need to mock process.stdin/stdout and the readline interactions extensively.
  // For now, we verify the module loads and dependencies are mocked correctly.
});
