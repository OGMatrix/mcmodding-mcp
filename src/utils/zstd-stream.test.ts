import { describe, it, expect } from 'vitest';
import { createZstdDecompressStream, isNativeZstdSupported } from './zstd-stream.js';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('zstd-stream', () => {
  it('should export createZstdDecompressStream factory', () => {
    expect(typeof createZstdDecompressStream).toBe('function');
  });

  it.runIf(isNativeZstdSupported())(
    'should stream decompress a zstd compressed payload',
    async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zstd-test-'));
      const inputPath = path.join(tmpDir, 'input.txt');
      const zstPath = path.join(tmpDir, 'input.txt.zst');
      const outputPath = path.join(tmpDir, 'output.txt');

      try {
        const originalContent = 'Hello zstd streaming decompression! '.repeat(100);
        fs.writeFileSync(inputPath, originalContent);

        try {
          execSync(`zstd --ultra -20 -T0 --long=29 "${inputPath}" -o "${zstPath}"`, {
            stdio: 'ignore',
          });
        } catch {
          return;
        }

        const readStream = fs.createReadStream(zstPath);
        const decompressStream = createZstdDecompressStream();
        const writeStream = fs.createWriteStream(outputPath);

        await new Promise<void>((resolve, reject) => {
          readStream
            .pipe(decompressStream)
            .pipe(writeStream)
            .on('finish', () => resolve())
            .on('error', (err) => reject(err));
        });

        const decompressedContent = fs.readFileSync(outputPath, 'utf-8');
        expect(decompressedContent).toBe(originalContent);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  );
});
