import zlib from 'zlib';
import { Transform } from 'stream';

// checks if node internal zlib.createZstdDecompress is supported in the current environment.
export function isNativeZstdSupported(): boolean {
  return (
    typeof (zlib as unknown as { createZstdDecompress?: unknown }).createZstdDecompress ===
    'function'
  );
}

// creates zstd decompression context using node internal zlib.createZstdDecompress().
export function createZstdDecompressStream(): Transform {
  const zlibAny = zlib as unknown as {
    createZstdDecompress?: (options?: { params?: Record<number, number> }) => Transform;
    constants?: { ZSTD_d_windowLogMax?: number };
  };

  if (typeof zlibAny.createZstdDecompress === 'function') {
    const windowLogMaxParam = zlibAny.constants?.ZSTD_d_windowLogMax;
    const options = windowLogMaxParam ? { params: { [windowLogMaxParam]: 29 } } : undefined;
    return zlibAny.createZstdDecompress(options);
  }

  throw new Error(
    `Native zstd decompression is not supported in this Node.js version (${process.version}). Please upgrade to Node.js >= 22.15.0 or Node.js 24+.`
  );
}
