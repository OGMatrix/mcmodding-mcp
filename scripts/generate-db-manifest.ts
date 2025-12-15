/* eslint-disable no-console */
/**
 * Generate database version manifest and prepare for release
 * Usage: tsx scripts/generate-db-manifest.ts [--version VERSION] [--type TYPE] [--changelog TEXT]
 */

import { DbVersioning } from '../src/db-versioning.js';
import fs from 'fs';
import path from 'path';

async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  let version = '0.1.1';
  let type: 'incremental' | 'full' = 'incremental';
  let changelog = 'Updated documentation index';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--version' && args[i + 1]) {
      version = args[++i];
    } else if (args[i] === '--type' && args[i + 1]) {
      type = args[++i] as 'incremental' | 'full';
    } else if (args[i] === '--changelog' && args[i + 1]) {
      changelog = args[++i];
    }
  }

  const versioning = new DbVersioning();

  try {
    console.log('📋 Generating database manifest...');
    const manifest = await versioning.createManifest(version, type, changelog);

    console.log(`\n✅ Manifest created successfully:`);
    console.log(`   Version: ${manifest.version}`);
    console.log(`   Type: ${manifest.type}`);
    console.log(`   Hash: ${manifest.hash.substring(0, 12)}...`);
    console.log(`   Size: ${(manifest.size / 1024 / 1024).toFixed(2)}MB`);
    console.log(`   Timestamp: ${manifest.timestamp}`);
    console.log(`\n📝 Changelog: ${manifest.changelog}`);

    // Write manifest to data directory for release
    const dataDir = path.join(process.cwd(), 'data');
    const manifestPath = path.join(dataDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    console.log(`\n✅ Manifest saved to: ${manifestPath}`);
    console.log(`✅ Ready to release as: db-v${version}`);
  } catch (error) {
    console.error('❌ Error generating manifest:', error);
    process.exit(1);
  }
}

void main();
