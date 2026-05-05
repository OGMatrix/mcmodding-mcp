/* eslint-disable no-console */
/**
 * Generate database version manifest and prepare for release
 * Usage: tsx scripts/generate-db-manifest.ts [--version VERSION] [--type TYPE] [--changelog TEXT] [--db-path PATH]
 *
 * --db-path PATH  Path to the database file to hash. When provided, the manifest
 *                 is generated from this exact file rather than the default shared
 *                 data directory. This guarantees the manifest hash matches the
 *                 file that will actually be uploaded to the release.
 */

import { DbVersioning } from '../src/db-versioning.js';
import fs from 'fs';
import path from 'path';

function bumpVersion(version: string, type: string): string {
  const parts = version.split('.').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) {
    console.warn(`Warning: Could not parse version ${version}, defaulting to 0.1.0`);
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
      patch++;
      break;
    default:
      console.warn(`Warning: Unknown bump type ${type}, using patch`);
      patch++;
  }

  return `${major}.${minor}.${patch}`;
}

async function main() {
  const args = process.argv.slice(2);

  // Parse --db-path early so we can construct DbVersioning with the right path
  let dbPath: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--db-path' && args[i + 1]) {
      dbPath = path.resolve(args[++i]);
    }
  }

  // If --db-path is provided, pass it to DbVersioning so createManifest hashes
  // the exact file that will be uploaded (not the shared data dir copy).
  const versioning = new DbVersioning(dbPath);
  const localManifest = versioning.getLocalManifest();

  // Default to existing manifest version or 0.1.0 if not found
  // This ensures DB version is independent of package.json version
  let version = localManifest?.version || '0.1.0';
  let type: 'incremental' | 'full' = 'incremental';
  let changelog = 'Updated documentation index';
  let releaseTag = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--version' && args[i + 1]) {
      version = args[++i];
    } else if (args[i] === '--bump' && args[i + 1]) {
      const bumpType = args[++i];
      const oldVersion = version;
      version = bumpVersion(version, bumpType);
      console.log(`Bumped version: ${oldVersion} -> ${version} (${bumpType})`);
    } else if (args[i] === '--type' && args[i + 1]) {
      type = args[++i] as 'incremental' | 'full';
    } else if (args[i] === '--changelog' && args[i + 1]) {
      changelog = args[++i];
    } else if (args[i] === '--release-tag' && args[i + 1]) {
      releaseTag = args[++i];
    } else if (args[i] === '--db-path') {
      i++; // already consumed above
    }
  }

  if (dbPath) {
    console.log(`📂 Using explicit DB path: ${dbPath}`);
  }

  try {
    console.log('📋 Generating database manifest...');
    const manifest = await versioning.createManifest(version, type, changelog, releaseTag);

    console.log(`\n✅ Manifest created successfully:`);
    console.log(`   Version: ${manifest.version}`);
    console.log(`   Type: ${manifest.type}`);
    console.log(`   Hash: ${manifest.hash.substring(0, 12)}...`);
    console.log(`   Size: ${(manifest.size / 1024 / 1024).toFixed(2)}MB`);
    console.log(`   Timestamp: ${manifest.timestamp}`);
    console.log(`\n📝 Changelog: ${manifest.changelog}`);

    // Write manifest to data directory for release
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const manifestPath = path.join(dataDir, 'db-manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    console.log(`\n✅ Manifest saved to: ${manifestPath}`);
    console.log(`✅ Ready to release as: db-v${version}`);
  } catch (error) {
    console.error('❌ Error generating manifest:', error);
    process.exit(1);
  }
}

void main();
