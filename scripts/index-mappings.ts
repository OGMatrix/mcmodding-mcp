#!/usr/bin/env npx tsx
/**
 * Parchment + Mojang Mappings Indexer
 *
 * Downloads and indexes both Parchment and Mojang official mappings from their
 * respective sources into a SQLite database for comprehensive Minecraft name lookups.
 *
 * Data sources:
 * - Parchment (maven.parchmentmc.org): Parameter names, javadoc documentation
 * - Mojang Official (piston-meta.mojang.com): Obfuscated → deobfuscated mappings
 *
 * Features:
 * - Dynamic version discovery (no hardcoded version list)
 * - Pre-release version handling (1.21.6-pre1, snapshots)
 * - Obfuscated name integration from Mojang
 * - Full-text search with FTS5
 *
 * NOT included in npm package - for local/maintainer use only.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { existsSync, mkdirSync, rmSync, readFileSync, createWriteStream } from 'fs';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

const CONFIG = {
  // Parchment Maven repository
  mavenBaseUrl: 'https://maven.parchmentmc.org',
  parchmentGroup: 'org/parchmentmc/data',

  // Mojang version manifest
  mojangManifestUrl: 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',

  // Database
  dbPath: path.join(process.cwd(), 'data', 'parchment-mappings.db'),
  dataDir: path.join(process.cwd(), 'data'),
  tempDir: path.join(process.cwd(), 'data', 'temp-parchment'),

  // Version filtering options
  includePreReleases: false, // Set to true to include pre-releases and snapshots
  includeSnapshots: false, // Set to true to include snapshots

  // Rate limiting
  downloadDelayMs: 500,
};

// ═══════════════════════════════════════════════════════════════════════════════
// INTERFACES
// ═══════════════════════════════════════════════════════════════════════════════

interface ParchmentData {
  version: string;
  packages: ParchmentPackage[];
  classes: ParchmentClass[];
}

interface ParchmentPackage {
  name: string;
  javadoc?: string[];
}

interface ParchmentClass {
  name: string;
  javadoc?: string[];
  fields?: ParchmentField[];
  methods?: ParchmentMethod[];
}

interface ParchmentField {
  name: string;
  descriptor: string;
  javadoc?: string[];
}

interface ParchmentMethod {
  name: string;
  descriptor: string;
  javadoc?: string[];
  parameters?: ParchmentParameter[];
}

interface ParchmentParameter {
  index: number;
  name: string;
  javadoc?: string;
}

interface MavenMetadata {
  versioning: {
    latest: string;
    release: string;
    versions: string[];
  };
}

interface IndexStats {
  classes: number;
  methods: number;
  fields: number;
  parameters: number;
  documentedMethods: number;
  documentedFields: number;
}

/** Mojang version manifest structure */
interface MojangVersionManifest {
  latest: {
    release: string;
    snapshot: string;
  };
  versions: MojangVersionEntry[];
}

interface MojangVersionEntry {
  id: string;
  type: 'release' | 'snapshot' | 'old_beta' | 'old_alpha';
  url: string;
  releaseTime: string;
  sha1: string;
}

interface MojangVersionDetails {
  downloads: {
    client: { url: string; sha1: string; size: number };
    client_mappings?: { url: string; sha1: string; size: number };
    server: { url: string; sha1: string; size: number };
    server_mappings?: { url: string; sha1: string; size: number };
  };
}

/** Parsed Mojang ProGuard-style mappings */
interface MojangMappings {
  classes: Map<string, MojangClassMapping>;
}

interface MojangClassMapping {
  deobfuscated: string; // e.g., "net.minecraft.world.entity.player.Player"
  obfuscated: string; // e.g., "xyz"
  methods: Map<string, MojangMethodMapping>;
  fields: Map<string, MojangFieldMapping>;
}

interface MojangMethodMapping {
  deobfuscated: string; // method name only
  obfuscated: string;
  descriptor: string; // e.g., "(II)V"
}

interface MojangFieldMapping {
  deobfuscated: string; // field name only
  obfuscated: string;
  type: string; // field type
}

/** Discovered Parchment version info */
interface ParchmentVersionInfo {
  mcVersion: string;
  parchmentVersion: string;
  isPreRelease: boolean;
  isSnapshot: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// LOGGING
// ═══════════════════════════════════════════════════════════════════════════════

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function log(level: 'info' | 'warn' | 'error' | 'success' | 'debug', message: string): void {
  const icons = { info: 'ℹ️', warn: '⚠️', error: '❌', success: '✅', debug: '🔍' };
  const colorMap = {
    info: colors.cyan,
    warn: colors.yellow,
    error: colors.red,
    success: colors.green,
    debug: colors.dim,
  };
  console.log(`${colorMap[level]}${icons[level]} ${message}${colors.reset}`);
}

function _logProgress(current: number, total: number, label: string): void {
  const percent = Math.round((current / total) * 100);
  const barLength = 30;
  const filled = Math.round((current / total) * barLength);
  const bar = '█'.repeat(filled) + '░'.repeat(barLength - filled);
  process.stdout.write(`\r${colors.cyan}[${bar}] ${percent}% ${label}${colors.reset}   `);
}

// ═══════════════════════════════════════════════════════════════════════════════
// DATABASE SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════

const SCHEMA = `
-- Metadata table for schema versioning
CREATE TABLE IF NOT EXISTS metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Classes table
CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  obfuscated_name TEXT,
  package_name TEXT NOT NULL,
  javadoc TEXT,
  minecraft_version TEXT NOT NULL,
  UNIQUE(name, package_name, minecraft_version)
);

-- Methods table
CREATE TABLE IF NOT EXISTS methods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  obfuscated_name TEXT,
  descriptor TEXT NOT NULL,
  javadoc TEXT,
  FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE
);

-- Fields table
CREATE TABLE IF NOT EXISTS fields (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  obfuscated_name TEXT,
  descriptor TEXT NOT NULL,
  javadoc TEXT,
  FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE
);

-- Parameters table
CREATE TABLE IF NOT EXISTS parameters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  method_id INTEGER NOT NULL,
  param_index INTEGER NOT NULL,
  name TEXT NOT NULL,
  javadoc TEXT,
  FOREIGN KEY (method_id) REFERENCES methods(id) ON DELETE CASCADE
);

-- Indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_classes_name ON classes(name);
CREATE INDEX IF NOT EXISTS idx_classes_package ON classes(package_name);
CREATE INDEX IF NOT EXISTS idx_classes_version ON classes(minecraft_version);
CREATE INDEX IF NOT EXISTS idx_classes_obf ON classes(obfuscated_name);
CREATE INDEX IF NOT EXISTS idx_methods_name ON methods(name);
CREATE INDEX IF NOT EXISTS idx_methods_class ON methods(class_id);
CREATE INDEX IF NOT EXISTS idx_methods_obf ON methods(obfuscated_name);
CREATE INDEX IF NOT EXISTS idx_fields_name ON fields(name);
CREATE INDEX IF NOT EXISTS idx_fields_class ON fields(class_id);
CREATE INDEX IF NOT EXISTS idx_fields_obf ON fields(obfuscated_name);
CREATE INDEX IF NOT EXISTS idx_parameters_method ON parameters(method_id);

-- Full-text search for classes
CREATE VIRTUAL TABLE IF NOT EXISTS classes_fts USING fts5(
  name,
  javadoc,
  content='classes',
  content_rowid='id'
);

-- Full-text search for methods
CREATE VIRTUAL TABLE IF NOT EXISTS methods_fts USING fts5(
  name,
  javadoc,
  content='methods',
  content_rowid='id'
);

-- Full-text search for fields
CREATE VIRTUAL TABLE IF NOT EXISTS fields_fts USING fts5(
  name,
  javadoc,
  content='fields',
  content_rowid='id'
);

-- Triggers for FTS sync
CREATE TRIGGER IF NOT EXISTS classes_ai AFTER INSERT ON classes BEGIN
  INSERT INTO classes_fts(rowid, name, javadoc) VALUES (new.id, new.name, new.javadoc);
END;

CREATE TRIGGER IF NOT EXISTS classes_ad AFTER DELETE ON classes BEGIN
  DELETE FROM classes_fts WHERE rowid = old.id;
END;

CREATE TRIGGER IF NOT EXISTS methods_ai AFTER INSERT ON methods BEGIN
  INSERT INTO methods_fts(rowid, name, javadoc) VALUES (new.id, new.name, new.javadoc);
END;

CREATE TRIGGER IF NOT EXISTS methods_ad AFTER DELETE ON methods BEGIN
  DELETE FROM methods_fts WHERE rowid = old.id;
END;

CREATE TRIGGER IF NOT EXISTS fields_ai AFTER INSERT ON fields BEGIN
  INSERT INTO fields_fts(rowid, name, javadoc) VALUES (new.id, new.name, new.javadoc);
END;

CREATE TRIGGER IF NOT EXISTS fields_ad AFTER DELETE ON fields BEGIN
  DELETE FROM fields_fts WHERE rowid = old.id;
END;
`;

// ═══════════════════════════════════════════════════════════════════════════════
// NETWORK UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

function fetchUrl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;

    const request = protocol.get(
      url,
      { headers: { 'User-Agent': 'mcmodding-mcp-indexer/1.0' } },
      (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            fetchUrl(redirectUrl).then(resolve).catch(reject);
            return;
          }
        }

        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
          return;
        }

        let data = '';
        response.on('data', (chunk) => (data += chunk));
        response.on('end', () => resolve(data));
        response.on('error', reject);
      }
    );

    request.on('error', reject);
    request.setTimeout(30000, () => {
      request.destroy();
      reject(new Error('Request timed out'));
    });
  });
}

async function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = createWriteStream(destPath);

    const request = protocol.get(
      url,
      { headers: { 'User-Agent': 'mcmodding-mcp-indexer/1.0' } },
      (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          file.close();
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            downloadFile(redirectUrl, destPath).then(resolve).catch(reject);
            return;
          }
        }

        if (response.statusCode !== 200) {
          file.close();
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
          return;
        }

        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
        response.on('error', (err) => {
          file.close();
          reject(err);
        });
      }
    );

    request.on('error', (err) => {
      file.close();
      reject(err);
    });

    request.setTimeout(60000, () => {
      request.destroy();
      reject(new Error('Download timed out'));
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════════════════════════════════════════════
// DYNAMIC VERSION DISCOVERY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Fetches all available Parchment versions from Maven repository.
 * Parses the HTML directory listing to discover versions dynamically.
 */
async function discoverParchmentVersions(): Promise<ParchmentVersionInfo[]> {
  const url = `${CONFIG.mavenBaseUrl}/${CONFIG.parchmentGroup}/`;
  log('info', 'Discovering available Parchment versions from Maven...');

  try {
    const html = await fetchUrl(url);

    // Parse HTML for parchment-X.XX.X directories
    // Format: <a href="parchment-1.21.6/">parchment-1.21.6/</a>
    const versionRegex = /href="parchment-([^"/]+)\/"/g;
    const versions: ParchmentVersionInfo[] = [];
    let match;

    while ((match = versionRegex.exec(html)) !== null) {
      const mcVersion = match[1];

      // Detect pre-release and snapshot versions
      const isPreRelease =
        /pre\d*|rc\d*/i.test(mcVersion) || mcVersion.includes('-pre') || mcVersion.includes('-rc');
      const isSnapshot =
        /snapshot|w\d{2}[a-z]/i.test(mcVersion) ||
        mcVersion.includes('snapshot') ||
        /^\d{2}w\d{2}/.test(mcVersion);

      versions.push({
        mcVersion,
        parchmentVersion: '', // Will be filled later
        isPreRelease,
        isSnapshot,
      });
    }

    // Sort versions semantically (newest first)
    versions.sort((a, b) => compareVersions(b.mcVersion, a.mcVersion));

    log('success', `Found ${versions.length} Parchment versions`);
    return versions;
  } catch (error) {
    log(
      'error',
      `Failed to discover Parchment versions: ${error instanceof Error ? error.message : String(error)}`
    );
    return [];
  }
}

/**
 * Compare Minecraft version strings semantically.
 * Handles versions like 1.21.11, 1.21.6-pre1, 24w10a etc.
 */
function compareVersions(a: string, b: string): number {
  // Extract main version parts (remove pre-release suffixes for comparison)
  const cleanA = a
    .replace(/-.*$/, '')
    .replace(/pre.*$/i, '')
    .replace(/rc.*$/i, '');
  const cleanB = b
    .replace(/-.*$/, '')
    .replace(/pre.*$/i, '')
    .replace(/rc.*$/i, '');

  const partsA = cleanA.split('.').map((p) => parseInt(p, 10) || 0);
  const partsB = cleanB.split('.').map((p) => parseInt(p, 10) || 0);

  // Pad arrays to same length
  const maxLen = Math.max(partsA.length, partsB.length);
  while (partsA.length < maxLen) partsA.push(0);
  while (partsB.length < maxLen) partsB.push(0);

  // Compare each part
  for (let i = 0; i < maxLen; i++) {
    if (partsA[i] > partsB[i]) return 1;
    if (partsA[i] < partsB[i]) return -1;
  }

  // If main versions are equal, pre-releases come before releases
  const aIsPre = /pre|rc|-/i.test(a);
  const bIsPre = /pre|rc|-/i.test(b);

  if (aIsPre && !bIsPre) return -1;
  if (!aIsPre && bIsPre) return 1;

  return 0;
}

/**
 * Filter versions based on configuration.
 */
function filterVersions(versions: ParchmentVersionInfo[]): ParchmentVersionInfo[] {
  return versions.filter((v) => {
    if (v.isSnapshot && !CONFIG.includeSnapshots) return false;
    if (v.isPreRelease && !CONFIG.includePreReleases) return false;
    return true;
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// MOJANG MAPPINGS INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════════

/** Cache for Mojang version manifest */
let mojangManifestCache: MojangVersionManifest | null = null;

/**
 * Fetch Mojang version manifest (cached).
 */
async function getMojangVersionManifest(): Promise<MojangVersionManifest> {
  if (mojangManifestCache) return mojangManifestCache;

  log('info', 'Fetching Mojang version manifest...');
  const json = await fetchUrl(CONFIG.mojangManifestUrl);
  mojangManifestCache = JSON.parse(json) as MojangVersionManifest;
  log('success', `Found ${mojangManifestCache.versions.length} Mojang versions`);
  return mojangManifestCache;
}

/**
 * Find Mojang version entry for a Minecraft version.
 * Handles pre-release versions by looking for exact match or base version.
 */
async function findMojangVersion(mcVersion: string): Promise<MojangVersionEntry | null> {
  const manifest = await getMojangVersionManifest();

  // Try exact match first
  let entry = manifest.versions.find((v) => v.id === mcVersion);
  if (entry) return entry;

  // For pre-releases like "1.21.6-pre1", try the base version
  // Parchment uses "1.21.6-pre1" but Mojang might use "1.21.6 Pre-Release 1"
  const baseVersion = mcVersion.replace(/-pre\d*$/i, '').replace(/-rc\d*$/i, '');

  // Try various Mojang naming conventions for pre-releases
  const variations = [
    mcVersion,
    mcVersion.replace('-pre', ' Pre-Release '),
    mcVersion.replace('-pre', ' pre'),
    mcVersion.replace('-rc', ' Release Candidate '),
    baseVersion,
  ];

  for (const variation of variations) {
    entry = manifest.versions.find(
      (v) => v.id.toLowerCase() === variation.toLowerCase() || v.id === variation
    );
    if (entry) return entry;
  }

  return null;
}

/**
 * Download and parse Mojang official mappings.
 */
async function downloadMojangMappings(mcVersion: string): Promise<MojangMappings | null> {
  const versionEntry = await findMojangVersion(mcVersion);
  if (!versionEntry) {
    log('warn', `No Mojang version found for ${mcVersion}`);
    return null;
  }

  try {
    // Fetch version details
    const detailsJson = await fetchUrl(versionEntry.url);
    const details = JSON.parse(detailsJson) as MojangVersionDetails;

    if (!details.downloads.client_mappings) {
      log('warn', `No client mappings available for ${mcVersion}`);
      return null;
    }

    // Download mappings file
    log('info', `Downloading Mojang mappings for ${mcVersion}...`);
    const mappingsText = await fetchUrl(details.downloads.client_mappings.url);

    // Parse ProGuard format
    return parseMojangMappings(mappingsText);
  } catch (error) {
    log(
      'error',
      `Failed to download Mojang mappings for ${mcVersion}: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}

/**
 * Parse Mojang ProGuard-style mappings.
 *
 * Format:
 * - Class: `fully.qualified.Name -> obf:`
 * - Field: `    type fieldName -> obf`
 * - Method: `    line:line:returnType methodName(args) -> obf`
 */
function parseMojangMappings(text: string): MojangMappings {
  const mappings: MojangMappings = {
    classes: new Map(),
  };

  const lines = text.split('\n');
  let currentClass: MojangClassMapping | null = null;

  for (const line of lines) {
    // Skip comments and empty lines
    if (line.startsWith('#') || line.trim() === '') continue;

    // Class mapping (no leading whitespace, ends with :)
    if (!line.startsWith(' ') && line.includes(' -> ') && line.endsWith(':')) {
      const match = line.match(/^(.+) -> (.+):$/);
      if (match) {
        const deobf = match[1].trim();
        const obf = match[2].trim();

        currentClass = {
          deobfuscated: deobf,
          obfuscated: obf,
          methods: new Map(),
          fields: new Map(),
        };
        mappings.classes.set(deobf, currentClass);
      }
      continue;
    }

    // Member mapping (has leading whitespace)
    if (currentClass && line.startsWith('    ')) {
      const memberLine = line.trim();

      if (memberLine.includes('(')) {
        // Method: line:line:returnType methodName(args) -> obf
        // OR: returnType methodName(args) -> obf
        const methodMatch = memberLine.match(
          /^(?:\d+:\d+:)?(.+?) ([a-zA-Z_$][a-zA-Z0-9_$]*)\(([^)]*)\) -> (.+)$/
        );
        if (methodMatch) {
          const returnType = methodMatch[1];
          const methodName = methodMatch[2];
          const args = methodMatch[3];
          const obfName = methodMatch[4];

          // Build a unique key for the method (name + args)
          const key = `${methodName}(${args})`;
          currentClass.methods.set(key, {
            deobfuscated: methodName,
            obfuscated: obfName,
            descriptor: `(${args})${returnType}`, // Simplified descriptor
          });
        }
      } else {
        // Field: type fieldName -> obf
        const fieldMatch = memberLine.match(/^(.+?) ([a-zA-Z_$][a-zA-Z0-9_$]*) -> (.+)$/);
        if (fieldMatch) {
          const fieldType = fieldMatch[1];
          const fieldName = fieldMatch[2];
          const obfName = fieldMatch[3];

          currentClass.fields.set(fieldName, {
            deobfuscated: fieldName,
            obfuscated: obfName,
            type: fieldType,
          });
        }
      }
    }
  }

  log('success', `Parsed ${mappings.classes.size} classes with obfuscated mappings`);
  return mappings;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PARCHMENT DATA FETCHING
// ═══════════════════════════════════════════════════════════════════════════════

async function fetchMavenMetadata(mcVersion: string): Promise<MavenMetadata | null> {
  const metadataUrl = `${CONFIG.mavenBaseUrl}/${CONFIG.parchmentGroup}/parchment-${mcVersion}/maven-metadata.xml`;

  try {
    const xml = await fetchUrl(metadataUrl);

    // Parse XML manually (simple approach for maven-metadata.xml)
    const latestMatch = xml.match(/<latest>([^<]+)<\/latest>/);
    const releaseMatch = xml.match(/<release>([^<]+)<\/release>/);
    const versionsMatch = xml.match(/<versions>([\s\S]*?)<\/versions>/);

    if (!versionsMatch) return null;

    const versions: string[] = [];
    const versionMatches = versionsMatch[1].matchAll(/<version>([^<]+)<\/version>/g);
    for (const match of versionMatches) {
      versions.push(match[1]);
    }

    return {
      versioning: {
        latest: latestMatch?.[1] || versions[versions.length - 1] || '',
        release: releaseMatch?.[1] || versions[versions.length - 1] || '',
        versions,
      },
    };
  } catch {
    return null;
  }
}

async function downloadParchmentData(
  mcVersion: string,
  parchmentVersion: string
): Promise<ParchmentData | null> {
  const zipFileName = `parchment-${mcVersion}-${parchmentVersion}.zip`;
  const downloadUrl = `${CONFIG.mavenBaseUrl}/${CONFIG.parchmentGroup}/parchment-${mcVersion}/${parchmentVersion}/${zipFileName}`;

  // Ensure temp directory exists
  if (!existsSync(CONFIG.tempDir)) {
    mkdirSync(CONFIG.tempDir, { recursive: true });
  }

  const zipPath = path.join(CONFIG.tempDir, zipFileName);
  const extractDir = path.join(CONFIG.tempDir, `parchment-${mcVersion}-${parchmentVersion}`);

  try {
    log('info', `Downloading ${zipFileName}...`);
    await downloadFile(downloadUrl, zipPath);

    // Extract ZIP file
    log('info', `Extracting ${zipFileName}...`);
    const AdmZip = (await import('adm-zip')).default;
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(extractDir, true);

    // Find and parse parchment.json
    const jsonPath = path.join(extractDir, 'parchment.json');
    if (!existsSync(jsonPath)) {
      log('warn', `parchment.json not found in ${zipFileName}`);
      return null;
    }

    const jsonContent = readFileSync(jsonPath, 'utf-8');
    const data = JSON.parse(jsonContent) as ParchmentData;

    // Cleanup
    rmSync(zipPath, { force: true });
    rmSync(extractDir, { recursive: true, force: true });

    return data;
  } catch (error) {
    // Cleanup on error
    if (existsSync(zipPath)) rmSync(zipPath, { force: true });
    if (existsSync(extractDir)) rmSync(extractDir, { recursive: true, force: true });

    const message = error instanceof Error ? error.message : String(error);
    log('error', `Failed to download/extract ${zipFileName}: ${message}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DATABASE OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════════

function initializeDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  db.exec(SCHEMA);

  // Set schema version
  db.prepare(`INSERT OR REPLACE INTO metadata (key, value) VALUES ('schema_version', '1')`).run();

  return db;
}

function indexParchmentData(
  db: Database.Database,
  data: ParchmentData,
  mcVersion: string,
  mojangMappings?: MojangMappings | null
): IndexStats {
  const stats: IndexStats = {
    classes: 0,
    methods: 0,
    fields: 0,
    parameters: 0,
    documentedMethods: 0,
    documentedFields: 0,
  };

  // Prepared statements
  const insertClass = db.prepare(`
    INSERT OR REPLACE INTO classes (name, obfuscated_name, package_name, javadoc, minecraft_version)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertMethod = db.prepare(`
    INSERT INTO methods (class_id, name, obfuscated_name, descriptor, javadoc)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertField = db.prepare(`
    INSERT INTO fields (class_id, name, obfuscated_name, descriptor, javadoc)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertParameter = db.prepare(`
    INSERT INTO parameters (method_id, param_index, name, javadoc)
    VALUES (?, ?, ?, ?)
  `);

  // Process classes
  const transaction = db.transaction(() => {
    for (const cls of data.classes) {
      // Parse class name to extract package and simple name
      // Parchment uses internal format: net/minecraft/world/entity/player/Player
      const lastSlash = cls.name.lastIndexOf('/');
      const packageName =
        lastSlash >= 0 ? cls.name.substring(0, lastSlash).replace(/\//g, '.') : '';
      const simpleName = lastSlash >= 0 ? cls.name.substring(lastSlash + 1) : cls.name;

      // Convert to fully qualified name for Mojang lookup
      const fullyQualifiedName = cls.name.replace(/\//g, '.');

      // Get obfuscated name from Mojang mappings
      let obfuscatedClassName: string | null = null;
      let mojangClass: MojangClassMapping | undefined;
      if (mojangMappings) {
        mojangClass = mojangMappings.classes.get(fullyQualifiedName);
        if (mojangClass) {
          obfuscatedClassName = mojangClass.obfuscated;
        }
      }

      const javadoc = cls.javadoc ? cls.javadoc.join('\n') : null;

      const result = insertClass.run(
        simpleName,
        obfuscatedClassName,
        packageName,
        javadoc,
        mcVersion
      );
      const classId = result.lastInsertRowid as number;
      stats.classes++;

      // Process methods
      if (cls.methods) {
        for (const method of cls.methods) {
          const methodJavadoc = method.javadoc ? method.javadoc.join('\n') : null;

          // Try to find obfuscated method name from Mojang mappings
          let obfuscatedMethodName: string | null = null;
          if (mojangClass) {
            // Try to match by method name and descriptor
            // Mojang uses Java-style types, Parchment uses JVM descriptors
            for (const [_key, mapping] of mojangClass.methods) {
              if (mapping.deobfuscated === method.name) {
                obfuscatedMethodName = mapping.obfuscated;
                break;
              }
            }
          }

          const methodResult = insertMethod.run(
            classId,
            method.name,
            obfuscatedMethodName,
            method.descriptor,
            methodJavadoc
          );
          const methodId = methodResult.lastInsertRowid as number;
          stats.methods++;

          if (methodJavadoc) stats.documentedMethods++;

          // Process parameters
          if (method.parameters) {
            for (const param of method.parameters) {
              insertParameter.run(methodId, param.index, param.name, param.javadoc || null);
              stats.parameters++;
            }
          }
        }
      }

      // Process fields
      if (cls.fields) {
        for (const field of cls.fields) {
          const fieldJavadoc = field.javadoc ? field.javadoc.join('\n') : null;

          // Try to find obfuscated field name from Mojang mappings
          let obfuscatedFieldName: string | null = null;
          if (mojangClass) {
            const mojangField = mojangClass.fields.get(field.name);
            if (mojangField) {
              obfuscatedFieldName = mojangField.obfuscated;
            }
          }

          insertField.run(classId, field.name, obfuscatedFieldName, field.descriptor, fieldJavadoc);
          stats.fields++;

          if (fieldJavadoc) stats.documentedFields++;
        }
      }
    }
  });

  transaction();

  return stats;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN INDEXING FLOW
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log(
    `\n${colors.bright}${colors.cyan}═══════════════════════════════════════════════════════════════${colors.reset}`
  );
  console.log(
    `${colors.bright}${colors.cyan}     Parchment + Mojang Mappings Indexer for mcmodding-mcp${colors.reset}`
  );
  console.log(
    `${colors.bright}${colors.cyan}═══════════════════════════════════════════════════════════════${colors.reset}\n`
  );

  // Parse command line arguments
  const args = process.argv.slice(2);
  const forceReindex = args.includes('--force') || args.includes('-f');
  const includePreReleases = args.includes('--pre-releases') || args.includes('-p');
  const includeSnapshots = args.includes('--snapshots') || args.includes('-s');
  const skipMojang = args.includes('--skip-mojang');
  const specificVersions = args.filter((a) => !a.startsWith('-'));

  // Update config based on args
  if (includePreReleases) CONFIG.includePreReleases = true;
  if (includeSnapshots) CONFIG.includeSnapshots = true;

  log('info', 'Options:');
  log('info', `  --force (-f): ${forceReindex ? 'Yes' : 'No'} - Rebuild database from scratch`);
  log(
    'info',
    `  --pre-releases (-p): ${CONFIG.includePreReleases ? 'Yes' : 'No'} - Include pre-releases`
  );
  log('info', `  --snapshots (-s): ${CONFIG.includeSnapshots ? 'Yes' : 'No'} - Include snapshots`);
  log('info', `  --skip-mojang: ${skipMojang ? 'Yes' : 'No'} - Skip Mojang obfuscation mappings`);
  console.log();

  // Ensure data directory exists
  if (!existsSync(CONFIG.dataDir)) {
    mkdirSync(CONFIG.dataDir, { recursive: true });
  }

  // Discover available versions dynamically OR use specific versions
  let targetVersions: ParchmentVersionInfo[];

  if (specificVersions.length > 0) {
    // User specified versions
    targetVersions = specificVersions.map((v) => ({
      mcVersion: v,
      parchmentVersion: '',
      isPreRelease: /pre|rc/i.test(v),
      isSnapshot: /snapshot|w\d{2}[a-z]/i.test(v),
    }));
    log('info', `Using ${targetVersions.length} specified versions`);
  } else {
    // Discover from Maven
    const allVersions = await discoverParchmentVersions();
    targetVersions = filterVersions(allVersions);
    log('info', `Filtered to ${targetVersions.length} versions (excluding pre-releases/snapshots)`);
  }

  if (targetVersions.length === 0) {
    log('error', 'No versions to process!');
    process.exit(1);
  }

  // Check if database exists
  const dbExists = existsSync(CONFIG.dbPath);
  if (dbExists && !forceReindex) {
    log('info', 'Database already exists. Use --force to rebuild.');
  }

  // Initialize database
  if (forceReindex && dbExists) {
    log('warn', 'Force flag set - rebuilding database...');
    rmSync(CONFIG.dbPath, { force: true });
    rmSync(CONFIG.dbPath + '-wal', { force: true });
    rmSync(CONFIG.dbPath + '-shm', { force: true });
  }

  const db = initializeDatabase(CONFIG.dbPath);

  try {
    let totalStats: IndexStats = {
      classes: 0,
      methods: 0,
      fields: 0,
      parameters: 0,
      documentedMethods: 0,
      documentedFields: 0,
    };

    let successCount = 0;
    let failCount = 0;
    let obfuscationStats = { withObf: 0, withoutObf: 0 };

    for (let i = 0; i < targetVersions.length; i++) {
      const versionInfo = targetVersions[i];
      const mcVersion = versionInfo.mcVersion;
      const preReleaseLabel = versionInfo.isPreRelease ? ' [pre-release]' : '';
      const snapshotLabel = versionInfo.isSnapshot ? ' [snapshot]' : '';

      console.log(
        `\n${colors.bright}[${i + 1}/${targetVersions.length}] Processing Minecraft ${mcVersion}${preReleaseLabel}${snapshotLabel}${colors.reset}`
      );

      // Check if already indexed
      const existingCount = db
        .prepare(`SELECT COUNT(*) as count FROM classes WHERE minecraft_version = ?`)
        .get(mcVersion) as { count: number };

      if (existingCount.count > 0 && !forceReindex) {
        log('info', `Already indexed ${existingCount.count} classes for ${mcVersion}, skipping.`);
        continue;
      }

      // Delete existing data for this version if force reindexing
      if (forceReindex && existingCount.count > 0) {
        log('info', `Removing existing data for ${mcVersion}...`);
        db.prepare(`DELETE FROM classes WHERE minecraft_version = ?`).run(mcVersion);
      }

      // Fetch Maven metadata to find latest Parchment version
      log('info', `Fetching Maven metadata for ${mcVersion}...`);
      const metadata = await fetchMavenMetadata(mcVersion);

      if (!metadata || metadata.versioning.versions.length === 0) {
        log('warn', `No Parchment data available for Minecraft ${mcVersion}`);
        failCount++;
        continue;
      }

      // Use the latest version
      const parchmentVersion = metadata.versioning.release || metadata.versioning.latest;
      log('info', `Found Parchment version: ${parchmentVersion}`);

      // Download Mojang mappings (unless skipped)
      let mojangMappings: MojangMappings | null = null;
      if (!skipMojang) {
        await sleep(CONFIG.downloadDelayMs);
        mojangMappings = await downloadMojangMappings(mcVersion);
        if (mojangMappings) {
          obfuscationStats.withObf++;
        } else {
          obfuscationStats.withoutObf++;
        }
      }

      // Download and extract Parchment data
      await sleep(CONFIG.downloadDelayMs);
      const parchmentData = await downloadParchmentData(mcVersion, parchmentVersion);

      if (!parchmentData) {
        log('error', `Failed to get Parchment data for ${mcVersion}`);
        failCount++;
        continue;
      }

      // Index the data
      log('info', `Indexing ${parchmentData.classes.length} classes...`);
      const stats = indexParchmentData(db, parchmentData, mcVersion, mojangMappings);

      totalStats.classes += stats.classes;
      totalStats.methods += stats.methods;
      totalStats.fields += stats.fields;
      totalStats.parameters += stats.parameters;
      totalStats.documentedMethods += stats.documentedMethods;
      totalStats.documentedFields += stats.documentedFields;

      const obfLabel = mojangMappings ? ' (with obfuscated names)' : ' (no obfuscated names)';
      log(
        'success',
        `Indexed: ${stats.classes} classes, ${stats.methods} methods, ${stats.fields} fields, ${stats.parameters} parameters${obfLabel}`
      );
      successCount++;
    }

    // Cleanup temp directory
    if (existsSync(CONFIG.tempDir)) {
      rmSync(CONFIG.tempDir, { recursive: true, force: true });
    }

    // Store indexing metadata
    const timestamp = new Date().toISOString();
    db.prepare(`INSERT OR REPLACE INTO metadata (key, value) VALUES ('indexed_at', ?)`).run(
      timestamp
    );
    db.prepare(`INSERT OR REPLACE INTO metadata (key, value) VALUES ('versions_indexed', ?)`).run(
      JSON.stringify(
        targetVersions
          .map((v) => v.mcVersion)
          .filter((v) => {
            const count = db
              .prepare(`SELECT COUNT(*) as count FROM classes WHERE minecraft_version = ?`)
              .get(v) as { count: number };
            return count.count > 0;
          })
      )
    );
    db.prepare(
      `INSERT OR REPLACE INTO metadata (key, value) VALUES ('has_obfuscated_mappings', ?)`
    ).run(String(obfuscationStats.withObf > 0));

    // Final summary
    console.log(
      `\n${colors.bright}${colors.green}═══════════════════════════════════════════════════════════════${colors.reset}`
    );
    console.log(
      `${colors.bright}${colors.green}                      Indexing Complete!${colors.reset}`
    );
    console.log(
      `${colors.bright}${colors.green}═══════════════════════════════════════════════════════════════${colors.reset}\n`
    );

    log('success', `Versions processed: ${successCount} succeeded, ${failCount} failed`);
    if (!skipMojang) {
      log(
        'info',
        `Obfuscation mappings: ${obfuscationStats.withObf} with, ${obfuscationStats.withoutObf} without`
      );
    }
    console.log(`\n${colors.cyan}📊 Total Statistics:${colors.reset}`);
    console.log(`   • Classes:           ${totalStats.classes.toLocaleString()}`);
    console.log(`   • Methods:           ${totalStats.methods.toLocaleString()}`);
    console.log(`   • Fields:            ${totalStats.fields.toLocaleString()}`);
    console.log(`   • Parameters:        ${totalStats.parameters.toLocaleString()}`);
    console.log(`   • Documented Methods: ${totalStats.documentedMethods.toLocaleString()}`);
    console.log(`   • Documented Fields:  ${totalStats.documentedFields.toLocaleString()}`);

    // Database file size
    const dbStats = fs.statSync(CONFIG.dbPath);
    console.log(`\n   • Database Size:     ${(dbStats.size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   • Database Path:     ${CONFIG.dbPath}\n`);
  } finally {
    db.close();
  }
}

// Run
main().catch((error) => {
  log('error', `Fatal error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
