/**
 * Database versioning and update system
 * Manages version manifests, downloads, and integrity verification
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

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
    this.dbPath = dbPath || path.join(process.cwd(), 'data', 'mcmodding-docs.db');
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
      // This overrides the URL in the manifest which might be outdated or incorrect
      const dbAsset = release.assets.find((a) => a.name === 'mcmodding-docs.db');
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
        return true;
      }

      const remote = await this.getRemoteManifest();
      if (!remote) {
        console.error('[DbVersioning] Could not fetch remote manifest');
        return false;
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
   * Download and verify database file
   */
  async downloadDatabase(manifest: DbVersionManifest): Promise<boolean> {
    try {
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

      // Write downloaded file
      const buffer = await response.arrayBuffer();
      const tempPath = `${this.dbPath}.tmp`;
      fs.writeFileSync(tempPath, Buffer.from(buffer));

      // Verify hash
      const downloadedHash = await this.calculateFileHash(tempPath);
      if (downloadedHash !== manifest.hash) {
        console.error(
          `[DbVersioning] Hash mismatch: expected ${manifest.hash}, got ${downloadedHash}`
        );
        fs.unlinkSync(tempPath);
        return false;
      }

      // Replace database
      fs.renameSync(tempPath, this.dbPath);
      console.error(`[DbVersioning] Successfully updated database to version ${manifest.version}`);

      return true;
    } catch (error) {
      console.error('[DbVersioning] Error downloading database:', error);
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
