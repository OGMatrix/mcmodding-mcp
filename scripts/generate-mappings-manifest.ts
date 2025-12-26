#!/usr/bin/env npx tsx
/**
 * Parchment Mappings Manifest Generator
 *
 * Generates a manifest file for the parchment-mappings.db database
 * with version, hash, and metadata for distribution.
 *
 * NOT included in npm package - for local/maintainer use only.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import Database from 'better-sqlite3';

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

const CONFIG = {
  dbPath: path.join(process.cwd(), 'data', 'parchment-mappings.db'),
  manifestPath: path.join(process.cwd(), 'data', 'parchment-mappings-manifest.json'),
  downloadUrlTemplate:
    'https://github.com/OGMatrix/mcmodding-mcp/releases/download/mappings-v{version}/parchment-mappings.db',
};

// ═══════════════════════════════════════════════════════════════════════════════
// INTERFACES
// ═══════════════════════════════════════════════════════════════════════════════

interface MappingsManifest {
  version: string;
  timestamp: string;
  hash: string;
  size: number;
  downloadUrl: string;
  stats: {
    classes: number;
    methods: number;
    fields: number;
    parameters: number;
    documentedMethods: number;
    documentedFields: number;
  };
  minecraftVersions: string[];
  topPackages: Array<{
    packageName: string;
    classCount: number;
  }>;
  changelog: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

function calculateFileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function log(level: 'info' | 'warn' | 'error' | 'success', message: string): void {
  const icons = { info: 'ℹ️', warn: '⚠️', error: '❌', success: '✅' };
  const colors = { info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m', success: '\x1b[32m' };
  const reset = '\x1b[0m';
  console.log(`${colors[level]}${icons[level]} ${message}${reset}`);
}

function bumpVersion(version: string, type: string): string {
  const parts = version.split('.').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) {
    log('warn', `Warning: Could not parse version ${version}, defaulting to 0.1.0`);
    return '0.1.0';
  }

  let [major, minor, patch] = parts;

  switch (type.toLowerCase()) {
    case 'major':
      major++;
      minor = 0;
      patch = 0;
      break;
    case 'minor':
      minor++;
      patch = 0;
      break;
    case 'patch':
    default:
      patch++;
      break;
  }

  return `${major}.${minor}.${patch}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('\n🗺️  Parchment Mappings Manifest Generator\n');

  // Check if database exists
  if (!fs.existsSync(CONFIG.dbPath)) {
    log('error', `Database not found at ${CONFIG.dbPath}`);
    log('info', 'Run `npm run index-mappings` first to create the database.');
    process.exit(1);
  }

  // Parse command line arguments
  const args = process.argv.slice(2);
  let bumpType = 'patch';
  let changelog = 'Parchment mappings update';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--bump' && args[i + 1]) {
      bumpType = args[i + 1];
      i++;
    } else if (args[i] === '--changelog' && args[i + 1]) {
      changelog = args[i + 1];
      i++;
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log('Usage: npx tsx scripts/generate-mappings-manifest.ts [options]');
      console.log('');
      console.log('Options:');
      console.log('  --bump <type>      Version bump type: major, minor, patch (default: patch)');
      console.log('  --changelog <msg>  Changelog message for this release');
      console.log('  --help, -h         Show this help message');
      process.exit(0);
    }
  }

  // Open database
  const db = new Database(CONFIG.dbPath, { readonly: true });

  try {
    // Get statistics
    log('info', 'Gathering database statistics...');

    const stats = db
      .prepare(
        `
        SELECT
          (SELECT COUNT(*) FROM classes) as classes,
          (SELECT COUNT(*) FROM methods) as methods,
          (SELECT COUNT(*) FROM fields) as fields,
          (SELECT COUNT(*) FROM parameters) as parameters,
          (SELECT COUNT(*) FROM methods WHERE javadoc IS NOT NULL AND javadoc != '') as documentedMethods,
          (SELECT COUNT(*) FROM fields WHERE javadoc IS NOT NULL AND javadoc != '') as documentedFields
      `
      )
      .get() as {
      classes: number;
      methods: number;
      fields: number;
      parameters: number;
      documentedMethods: number;
      documentedFields: number;
    };

    // Get Minecraft versions
    const versions = db
      .prepare(`SELECT DISTINCT minecraft_version FROM classes ORDER BY minecraft_version DESC`)
      .all() as Array<{ minecraft_version: string }>;

    // Get top packages
    const topPackages = db
      .prepare(
        `
        SELECT package_name as packageName, COUNT(*) as classCount
        FROM classes
        GROUP BY package_name
        ORDER BY classCount DESC
        LIMIT 10
      `
      )
      .all() as Array<{ packageName: string; classCount: number }>;

    // Calculate file hash
    log('info', 'Calculating file hash...');
    const hash = await calculateFileHash(CONFIG.dbPath);

    // Get file size
    const fileStats = fs.statSync(CONFIG.dbPath);

    // Determine version
    let version = '0.1.0';
    if (fs.existsSync(CONFIG.manifestPath)) {
      try {
        const existingManifest = JSON.parse(
          fs.readFileSync(CONFIG.manifestPath, 'utf-8')
        ) as MappingsManifest;
        version = bumpVersion(existingManifest.version, bumpType);
      } catch {
        log('warn', 'Could not parse existing manifest, starting fresh.');
      }
    }

    // Build manifest
    const manifest: MappingsManifest = {
      version,
      timestamp: new Date().toISOString(),
      hash,
      size: fileStats.size,
      downloadUrl: CONFIG.downloadUrlTemplate.replace('{version}', version),
      stats,
      minecraftVersions: versions.map((v) => v.minecraft_version),
      topPackages,
      changelog,
    };

    // Write manifest
    fs.writeFileSync(CONFIG.manifestPath, JSON.stringify(manifest, null, 2));

    log('success', `Manifest generated: ${CONFIG.manifestPath}`);
    console.log('\n📋 Manifest Summary:');
    console.log(`   Version:            ${manifest.version}`);
    console.log(`   Database Size:      ${(manifest.size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Hash:               ${manifest.hash.substring(0, 16)}...`);
    console.log(`   Minecraft Versions: ${manifest.minecraftVersions.join(', ')}`);
    console.log('\n📊 Statistics:');
    console.log(`   Classes:            ${manifest.stats.classes.toLocaleString()}`);
    console.log(`   Methods:            ${manifest.stats.methods.toLocaleString()}`);
    console.log(`   Fields:             ${manifest.stats.fields.toLocaleString()}`);
    console.log(`   Parameters:         ${manifest.stats.parameters.toLocaleString()}`);
    console.log(`   Documented Methods: ${manifest.stats.documentedMethods.toLocaleString()}`);
    console.log(`   Documented Fields:  ${manifest.stats.documentedFields.toLocaleString()}`);
    console.log('\n📦 Top Packages:');
    for (const pkg of manifest.topPackages.slice(0, 5)) {
      console.log(`   ${pkg.packageName}: ${pkg.classCount} classes`);
    }
    console.log('');

    log('success', 'Done!');
    log('info', `Next steps:`);
    log('info', `  1. Commit the manifest: git add data/parchment-mappings-manifest.json`);
    log('info', `  2. Create release tag: git tag mappings-v${version}`);
    log('info', `  3. Push to GitHub: git push && git push --tags`);
    log('info', `  4. Upload parchment-mappings.db to the GitHub release`);
  } finally {
    db.close();
  }
}

main().catch((error) => {
  log('error', `Fatal error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
