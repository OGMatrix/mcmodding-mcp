/**
 * Integration tests for DbVersioning.downloadDatabase download paths.
 *
 * Uses a real local HTTP server, real files and (when available) the zstd CLI
 * so the compressed path is exercised end-to-end. Skipped entirely when the
 * current Node runtime lacks native zstd support; individual tests no-op when
 * the zstd CLI is not installed (e.g. Windows/macOS CI runners).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { DbVersioning } from './db-versioning.js';
import { isNativeZstdSupported } from './utils/zstd-stream.js';

const sourceContent = 'mcmodding-mcp integration test payload\n'.repeat(4096); // ~160 KB
const sourceHash = crypto.createHash('sha256').update(sourceContent).digest('hex');

let tmpDir = '';
let dbPath = '';
let zstPath = '';

function createServer(cutFraction: number | null): http.Server {
  return http.createServer((req, res) => {
    if (req.url === '/db.zst') {
      const full = fs.statSync(zstPath).size;
      const end = cutFraction === null ? full - 1 : Math.floor(full * cutFraction) - 1;
      // Advertise the full length so the client believes a complete asset was served
      res.writeHead(200, { 'content-length': full });
      fs.createReadStream(zstPath, { start: 0, end }).pipe(res);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
}

/**
 * Run `fn` while a local server is serving the (optionally truncated) .zst
 * frame, then close the server.
 */
async function withServer(
  cutFraction: number | null,
  fn: (baseUrl: string) => Promise<void>
): Promise<void> {
  const server = createServer(cutFraction);
  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        resolve(address.port);
      } else {
        reject(new Error('Failed to bind test server'));
      }
    });
  });
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe.skipIf(!isNativeZstdSupported())('DbVersioning.downloadDatabase (integration)', () => {
  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-versioning-test-'));
    dbPath = path.join(tmpDir, 'mcmodding-docs.db');
    zstPath = path.join(tmpDir, 'source.txt.zst');

    // Build a real zstd frame with the same flags the release workflows use
    const sourcePath = path.join(tmpDir, 'source.txt');
    fs.writeFileSync(sourcePath, sourceContent);
    try {
      execSync(`zstd --ultra -20 -T0 --long=29 "${sourcePath}" -o "${zstPath}"`, {
        stdio: 'ignore',
      });
    } catch {
      // zstd CLI not installed; the tests below will no-op via the guard
    }
  }, 30000);

  afterAll(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('installs a valid .zst asset and verifies the decompressed hash', async () => {
    if (!fs.existsSync(zstPath)) return; // zstd CLI unavailable

    await withServer(null, async (baseUrl) => {
      const versioning = new DbVersioning(dbPath);
      const ok = await versioning.downloadDatabase({
        version: '9.9.9',
        timestamp: new Date().toISOString(),
        type: 'full',
        hash: sourceHash,
        size: Buffer.byteLength(sourceContent),
        downloadUrl: `${baseUrl}/db.zst`,
        changelog: 'test',
      });

      expect(ok).toBe(true);
      expect(fs.existsSync(dbPath)).toBe(true);
      expect(fs.readFileSync(dbPath, 'utf-8')).toBe(sourceContent);
      expect(fs.existsSync(`${dbPath}.tmp`)).toBe(false);
    });
  }, 60000);

  it('rejects a truncated .zst asset and leaves no temp file behind', async () => {
    if (!fs.existsSync(zstPath)) return; // zstd CLI unavailable

    // Remove any DB installed by the previous test
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

    await withServer(0.5, async (baseUrl) => {
      // Serve only half the frame while claiming the full content length
      const versioning = new DbVersioning(dbPath);
      const ok = await versioning.downloadDatabase({
        version: '9.9.8',
        timestamp: new Date().toISOString(),
        type: 'full',
        hash: sourceHash,
        size: Buffer.byteLength(sourceContent),
        downloadUrl: `${baseUrl}/db.zst`,
        changelog: 'test',
      });

      // Whether the truncated frame surfaces as a stream error or as a
      // silent partial decode (current Node zstd behavior), the download
      // must fail and no partial temp file may be left behind.
      expect(ok).toBe(false);
      expect(fs.existsSync(dbPath)).toBe(false);
      expect(fs.existsSync(`${dbPath}.tmp`)).toBe(false);
    });
  }, 60000);
});
