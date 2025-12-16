#!/usr/bin/env npx tsx
/**
 * Mod Examples Manifest Generator
 *
 * Generates a manifest file for the mod-examples.db database
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
  dbPath: path.join(process.cwd(), 'data', 'mod-examples.db'),
  manifestPath: path.join(process.cwd(), 'data', 'mod-examples-manifest.json'),
  downloadUrlTemplate:
    'https://github.com/OGMatrix/mcmodding-mcp/releases/download/examples-v{version}/mod-examples.db',
};

// ═══════════════════════════════════════════════════════════════════════════════
// INTERFACES
// ═══════════════════════════════════════════════════════════════════════════════

interface ModExamplesManifest {
  version: string;
  timestamp: string;
  hash: string;
  size: number;
  downloadUrl: string;
  stats: {
    mods: number;
    examples: number;
    relations: number;
    categories: number;
    featuredExamples: number;
  };
  mods: Array<{
    name: string;
    repo: string;
    loader: string;
    exampleCount: number;
    categories: string[];
    starCount: number;
  }>;
  topCategories: Array<{
    slug: string;
    name: string;
    exampleCount: number;
  }>;
  qualityMetrics: {
    avgQualityScore: number;
    highQualityCount: number; // score >= 0.7
    expertLevelCount: number;
    advancedLevelCount: number;
  };
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
  const method = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
  method(`${colors[level]}${icons[level]} ${message}${reset}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN LOGIC
// ═══════════════════════════════════════════════════════════════════════════════

async function generateManifest(): Promise<void> {
  console.info('\n');
  console.info('╔══════════════════════════════════════════════════════════════╗');
  console.info('║     Mod Examples Manifest Generator                          ║');
  console.info('╚══════════════════════════════════════════════════════════════╝');
  console.info('\n');

  // Parse command line arguments
  const args = process.argv.slice(2);
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8')
  );
  const version =
    args.find((a) => a.startsWith('--version='))?.split('=')[1] || packageJson.version;
  const changelog =
    args.find((a) => a.startsWith('--changelog='))?.split('=')[1] || 'Mod examples update';

  // Check database exists
  if (!fs.existsSync(CONFIG.dbPath)) {
    log('error', `Database not found: ${CONFIG.dbPath}`);
    log('info', 'Run the mod indexer first: npx tsx scripts/index-mod-examples.ts');
    process.exit(1);
  }

  log('info', `Database: ${CONFIG.dbPath}`);
  log('info', `Version: ${version}`);

  // Calculate hash
  log('info', 'Calculating file hash...');
  const hash = await calculateFileHash(CONFIG.dbPath);
  const stats = fs.statSync(CONFIG.dbPath);
  log('success', `Hash: ${hash.slice(0, 16)}...`);
  log('success', `Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

  // Open database and gather statistics
  log('info', 'Gathering database statistics...');
  const db = new Database(CONFIG.dbPath, { readonly: true });

  // Basic stats
  const basicStats = db
    .prepare(
      `
    SELECT
      (SELECT COUNT(*) FROM mods) as mods,
      (SELECT COUNT(*) FROM examples) as examples,
      (SELECT COUNT(*) FROM example_relations) as relations,
      (SELECT COUNT(*) FROM categories) as categories,
      (SELECT COUNT(*) FROM examples WHERE is_featured = TRUE) as featured
  `
    )
    .get() as {
    mods: number;
    examples: number;
    relations: number;
    categories: number;
    featured: number;
  };

  // Mod details
  const modDetails = db
    .prepare(
      `
    SELECT
      m.name,
      m.repo,
      m.loader,
      m.star_count as starCount,
      COUNT(e.id) as exampleCount,
      GROUP_CONCAT(DISTINCT c.slug) as categories
    FROM mods m
    LEFT JOIN examples e ON e.mod_id = m.id
    LEFT JOIN categories c ON e.category_id = c.id
    GROUP BY m.id
    ORDER BY m.priority DESC, exampleCount DESC
  `
    )
    .all() as Array<{
    name: string;
    repo: string;
    loader: string;
    starCount: number;
    exampleCount: number;
    categories: string | null;
  }>;

  // Top categories
  const topCategories = db
    .prepare(
      `
    SELECT
      c.slug,
      c.name,
      COUNT(e.id) as exampleCount
    FROM categories c
    LEFT JOIN examples e ON e.category_id = c.id
    GROUP BY c.id
    HAVING exampleCount > 0
    ORDER BY exampleCount DESC
    LIMIT 10
  `
    )
    .all() as Array<{
    slug: string;
    name: string;
    exampleCount: number;
  }>;

  // Quality metrics
  const qualityMetrics = db
    .prepare(
      `
    SELECT
      AVG(quality_score) as avgQualityScore,
      SUM(CASE WHEN quality_score >= 0.7 THEN 1 ELSE 0 END) as highQualityCount,
      SUM(CASE WHEN complexity = 'expert' THEN 1 ELSE 0 END) as expertLevelCount,
      SUM(CASE WHEN complexity = 'advanced' THEN 1 ELSE 0 END) as advancedLevelCount
    FROM examples
  `
    )
    .get() as {
    avgQualityScore: number;
    highQualityCount: number;
    expertLevelCount: number;
    advancedLevelCount: number;
  };

  db.close();

  // Build manifest
  const manifest: ModExamplesManifest = {
    version,
    timestamp: new Date().toISOString(),
    hash,
    size: stats.size,
    downloadUrl: CONFIG.downloadUrlTemplate.replace('{version}', version),
    stats: {
      mods: basicStats.mods,
      examples: basicStats.examples,
      relations: basicStats.relations,
      categories: basicStats.categories,
      featuredExamples: basicStats.featured,
    },
    mods: modDetails.map((m) => ({
      name: m.name,
      repo: m.repo,
      loader: m.loader,
      exampleCount: m.exampleCount,
      categories: m.categories?.split(',').filter(Boolean) || [],
      starCount: m.starCount,
    })),
    topCategories,
    qualityMetrics: {
      avgQualityScore: Math.round((qualityMetrics.avgQualityScore || 0) * 100) / 100,
      highQualityCount: qualityMetrics.highQualityCount || 0,
      expertLevelCount: qualityMetrics.expertLevelCount || 0,
      advancedLevelCount: qualityMetrics.advancedLevelCount || 0,
    },
    changelog,
  };

  // Write manifest
  fs.writeFileSync(CONFIG.manifestPath, JSON.stringify(manifest, null, 2));
  log('success', `Manifest written: ${CONFIG.manifestPath}`);

  // Print summary
  console.info('\n');
  console.info('╔══════════════════════════════════════════════════════════════╗');
  console.info('║     Manifest Generated Successfully                          ║');
  console.info('╠══════════════════════════════════════════════════════════════╣');
  console.info(`║  📦 Version:           ${version.padEnd(10)}                         ║`);
  console.info(
    `║  📝 Total Examples:    ${String(basicStats.examples).padStart(6)}                             ║`
  );
  console.info(
    `║  🎯 High Quality:      ${String(qualityMetrics.highQualityCount).padStart(6)}                             ║`
  );
  console.info(
    `║  ⭐ Featured:          ${String(basicStats.featured).padStart(6)}                             ║`
  );
  console.info(
    `║  📊 Avg Quality:       ${(qualityMetrics.avgQualityScore || 0).toFixed(2).padStart(6)}                             ║`
  );
  console.info('╚══════════════════════════════════════════════════════════════╝');
  console.info('\n');

  // Print mods summary
  console.info('Indexed Mods:');
  console.info('─'.repeat(60));
  for (const mod of manifest.mods) {
    console.info(
      `  ${mod.name.padEnd(25)} ${String(mod.exampleCount).padStart(4)} examples  ⭐ ${mod.starCount}`
    );
  }
  console.info('\n');
}

generateManifest().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  log('error', `Fatal error: ${message}`);
  process.exit(1);
});
