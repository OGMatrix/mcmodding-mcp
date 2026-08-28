/**
 * Database versioning and update system
 * Manages version manifests, downloads, and integrity verification
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Readable, pipeline } from 'stream';
import { promisify } from 'util';
import { getDefaultDbPath } from './data-dir.js';
import { createZstdDecompressStream, isNativeZstdSupported } from './utils/zstd-stream.js';

const streamPipeline = promisify(pipeline);

export interface DbVersionManifest {
  version: string;
  timestamp: string;
  type: 'incremental' | 'full';
  hash: string;
  size: number;
  downloadUrl: string;
  changelog: string;
}

export class DbVersioning {
  private localManifestPath: string;
  private dbPath: string;
  private dataDir: string;
  private remoteRepoUrl: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath || getDefaultDbPath('mcmodding-docs.db');
    this.dataDir = path.dirname(this.dbPath);
    this.localManifestPath = path.join(this.dataDir, 'db-manifest.json');
    // Extract owner/repo from process.env or use defaults
    this.remoteRepoUrl =
      process.env.GITHUB_REPO_URL || 'https://api.github.com/repos/OGMatrix/mcmodding-mcp';
  }

  /**
   * Get local manifest or create default
   */
  getLocalManifest(): DbVersionManifest | null {
    try {
      if (!fs.existsSync(this.localManifestPath)) {
        return null;
      }
      const content = fs.readFileSync(this.localManifestPath, 'utf-8');
      return JSON.parse(content) as DbVersionManifest;
    } catch (error) {
      console.error('[DbVersioning] Error reading local manifest:', error);
      return null;
    }
  }

  /**
   * Fetch remote manifest from GitHub releases
   */
  async getRemoteManifest(): Promise<DbVersionManifest | null> {
    try {
      // Fetch latest release from GitHub API
      const releaseUrl = `${this.remoteRepoUrl}/releases/latest`;
      const response = await fetch(releaseUrl, {
        headers: {
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'mcmodding-mcp',
        },
      });

      if (!response.ok) {
        console.error(`[DbVersioning] Failed to fetch releases: ${response.status}`);
        return null;
      }

      const release = (await response.json()) as {
        name: string;
        tag_name: string;
        assets: Array<{ name: string; browser_download_url: string }>;
        body: string;
      };

      // Look for manifest in release assets or body
      const manifestAsset = release.assets.find((a) => a.name === 'db-manifest.json');
      if (!manifestAsset) {
        console.error('[DbVersioning] No manifest found in release');
        return null;
      }

      const manifestResponse = await fetch(manifestAsset.browser_download_url);
      if (!manifestResponse.ok) {
        console.error('[DbVersioning] Failed to fetch manifest from release');
        return null;
      }

      const manifest = (await manifestResponse.json()) as DbVersionManifest;

      // Find the database asset in the release to ensure we have the correct download URL
      // Prefer compressed (.db.zst) if native zstd is supported in this Node runtime, otherwise fallback to uncompressed (.db)
      const zstAsset = isNativeZstdSupported()
        ? release.assets.find((a) => a.name === 'mcmodding-docs.db.zst')
        : undefined;
      const dbAsset = zstAsset || release.assets.find((a) => a.name === 'mcmodding-docs.db');
      if (dbAsset) {
        manifest.downloadUrl = dbAsset.browser_download_url;
      }

      return manifest;
    } catch (error) {
      console.error('[DbVersioning] Error fetching remote manifest:', error);
      return null;
    }
  }

  /**
   * Compare semantic versions
   * Returns: -1 if local < remote, 1 if local > remote, 0 if equal
   */
  compareVersions(local: string, remote: string): number {
    const localParts = local.split('.').map((p) => parseInt(p, 10));
    const remoteParts = remote.split('.').map((p) => parseInt(p, 10));

    for (let i = 0; i < 3; i++) {
      const l = localParts[i] ?? 0;
      const r = remoteParts[i] ?? 0;
      if (l < r) return -1;
      if (l > r) return 1;
    }
    return 0;
  }

  /**
   * Calculate SHA256 hash of file
   */
  async calculateFileHash(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);

      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  /**
   * Check if update is available
   */
  async isUpdateAvailable(): Promise<boolean> {
    try {
      const local = this.getLocalManifest();
      if (!local) {
        console.error('[DbVersioning] No local manifest found, update available');
      }

      const remote = await this.getRemoteManifest();
      if (!remote) {
        console.error('[DbVersioning] Could not fetch remote manifest');
        return false;
      }

      // If we previously tried and failed to download this exact version+hash,
      // skip re-downloading to prevent an infinite loop caused by a broken release.
      if (this.isVersionMarkedFailed(remote)) {
        console.error(
          `[DbVersioning] Skipping update: version ${remote.version} previously failed hash verification (broken release asset)`
        );
        return false;
      }

      if (!local) {
        return true;
      }

      const comparison = this.compareVersions(local.version, remote.version);
      if (comparison < 0) {
        console.error(`[DbVersioning] Update available: ${local.version} -> ${remote.version}`);
        return true;
      }

      return false;
    } catch (error) {
      console.error('[DbVersioning] Error checking for updates:', error);
      return false;
    }
  }

  /**
   * Check whether the given remote manifest has been marked as a failed download
   * (i.e. its hash did not match the actual file bytes).
   */
  private isVersionMarkedFailed(manifest: DbVersionManifest): boolean {
    const failedMarkerPath = path.join(this.dataDir, 'db-download-failed.json');
    if (!fs.existsSync(failedMarkerPath)) return false;
    try {
      const failed = JSON.parse(fs.readFileSync(failedMarkerPath, 'utf-8')) as {
        version: string;
        hash: string;
      };
      return failed.version === manifest.version && failed.hash === manifest.hash;
    } catch {
      return false;
    }
  }

  /**
   * Download and verify database file
   */
  async downloadDatabase(manifest: DbVersionManifest): Promise<boolean> {
    let tempPath: string | null = null;
    try {
      // Ensure data directory exists before downloading
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }

      console.error(`[DbVersioning] Downloading database version ${manifest.version}...`);

      const response = await fetch(manifest.downloadUrl);
      if (!response.ok) {
        console.error(`[DbVersioning] Failed to download: ${response.status}`);
        return false;
      }

      // Create backup of current database
      if (fs.existsSync(this.dbPath)) {
        const backupPath = `${this.dbPath}.backup`;
        fs.copyFileSync(this.dbPath, backupPath);
        console.error(`[DbVersioning] Created backup at ${backupPath}`);
      }

      // write downloaded file with streaming (and decompress if zstd)
      tempPath = `${this.dbPath}.tmp`;
      const isCompressed = manifest.downloadUrl.endsWith('.zst');

      if (response.body) {
        const fileWriteStream = fs.createWriteStream(tempPath);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
        const nodeStream = Readable.fromWeb(response.body as any);
        if (isCompressed) {
          console.error(`[DbVersioning] Decompressing zstd stream to ${tempPath}...`);
          const decompressStream = createZstdDecompressStream();
          await streamPipeline(nodeStream, decompressStream, fileWriteStream);
        } else {
          await streamPipeline(nodeStream, fileWriteStream);
        }
      } else {
        const buffer = await response.arrayBuffer();
        fs.writeFileSync(tempPath, Buffer.from(buffer));
      }

      // Verify hash
      const downloadedHash = await this.calculateFileHash(tempPath);
      if (downloadedHash !== manifest.hash) {
        console.error(
          `[DbVersioning] Hash mismatch: expected ${manifest.hash}, got ${downloadedHash}`
        );
        fs.unlinkSync(tempPath);

        // Save a "failed download" marker so subsequent startups skip re-downloading
        // the same broken release, preventing an infinite download loop.
        const failedMarkerPath = path.join(this.dataDir, 'db-download-failed.json');
        try {
          fs.writeFileSync(
            failedMarkerPath,
            JSON.stringify(
              {
                version: manifest.version,
                hash: manifest.hash,
                actualHash: downloadedHash,
                failedAt: new Date().toISOString(),
                reason: `Hash mismatch: expected ${manifest.hash}, got ${downloadedHash}`,
              },
              null,
              2
            )
          );
          console.error(
            `[DbVersioning] Saved failed-download marker (version ${manifest.version}) to prevent re-download loops`
          );
        } catch (markerErr) {
          console.error('[DbVersioning] Could not save failed-download marker:', markerErr);
        }

        return false;
      }

      // Replace database
      fs.renameSync(tempPath, this.dbPath);

      // Clear any previous failed-download marker now that we have a good DB
      const failedMarkerPath = path.join(this.dataDir, 'db-download-failed.json');
      if (fs.existsSync(failedMarkerPath)) {
        fs.unlinkSync(failedMarkerPath);
        console.error('[DbVersioning] Cleared failed-download marker after successful update');
      }

      console.error(`[DbVersioning] Successfully updated database to version ${manifest.version}`);

      return true;
    } catch (error) {
      console.error('[DbVersioning] Error downloading database:', error);
      // Clean up a partially-downloaded temp file (e.g. network drop or
      // decompression failure) so it cannot be mistaken for a valid database.
      if (tempPath && fs.existsSync(tempPath)) {
        try {
          fs.unlinkSync(tempPath);
        } catch {
          // Ignore cleanup errors; the original error is already logged.
        }
      }
      return false;
    }
  }

  /**
   * Save manifest locally
   */
  saveManifest(manifest: DbVersionManifest): void {
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }
      fs.writeFileSync(this.localManifestPath, JSON.stringify(manifest, null, 2));
      console.error(`[DbVersioning] Saved manifest version ${manifest.version}`);
    } catch (error) {
      console.error('[DbVersioning] Error saving manifest:', error);
    }
  }

  /**
   * Create new manifest after indexing
   * Called by build scripts
   */
  async createManifest(
    version: string,
    type: 'incremental' | 'full',
    changelog: string,
    releaseTag?: string
  ): Promise<DbVersionManifest> {
    try {
      if (!fs.existsSync(this.dbPath)) {
        throw new Error('Database file not found');
      }

      const hash = await this.calculateFileHash(this.dbPath);
      const stats = fs.statSync(this.dbPath);

      // Use provided release tag or fallback to version-based tag (legacy behavior)
      const downloadUrl = releaseTag
        ? `https://github.com/OGMatrix/mcmodding-mcp/releases/download/${releaseTag}/mcmodding-docs.db`
        : `https://github.com/OGMatrix/mcmodding-mcp/releases/download/v${version}/mcmodding-docs.db`;

      const manifest: DbVersionManifest = {
        version,
        timestamp: new Date().toISOString(),
        type,
        hash,
        size: stats.size,
        downloadUrl,
        changelog,
      };

      this.saveManifest(manifest);
      return manifest;
    } catch (error) {
      console.error('[DbVersioning] Error creating manifest:', error);
      throw error;
    }
  }

  /**
   * Perform automatic update check and download if needed
   * This is called on MCP startup
   */
  async autoUpdate(): Promise<boolean> {
    try {
      const hasUpdate = await this.isUpdateAvailable();
      if (!hasUpdate) {
        console.error('[DbVersioning] Database is up to date');
        return false;
      }

      const remote = await this.getRemoteManifest();
      if (!remote) {
        console.error('[DbVersioning] Could not fetch remote manifest for update');
        return false;
      }

      const success = await this.downloadDatabase(remote);
      if (success) {
        this.saveManifest(remote);
        return true;
      }

      return false;
    } catch (error) {
      console.error('[DbVersioning] Error during auto-update:', error);
      return false;
    }
  }

  /**
   * Get version information for display
   */
  getVersionInfo(): { local: string; remote: string | null; upToDate: boolean } {
    const local = this.getLocalManifest();
    return {
      local: local?.version ?? 'unknown',
      remote: null,
      upToDate: true,
    };
  }
}
