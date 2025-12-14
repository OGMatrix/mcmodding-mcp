#!/usr/bin/env tsx
/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable no-undef */
/**
 * Advanced documentation indexing script with full feature support
 * - Sitemap-based URL discovery
 * - Semantic search embeddings
 * - Version-aware indexing
 * - Incremental updates
 */

import { mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import { DocumentCrawler, getFabricDocumentationUrls } from '../src/indexer/crawler.js';
import { DocumentChunker } from '../src/indexer/chunker.js';
import { DocumentStore } from '../src/indexer/store.js';
import {
  getFabricUrlsFromSitemap,
  getFabricWikiUrlsFromSitemap,
  getNeoforgeUrlsFromSitemap,
} from '../src/indexer/sitemap.js';
import { EmbeddingGenerator } from '../src/indexer/embeddings.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface IndexOptions {
  force?: boolean;
  incremental?: boolean;
  useSitemap?: boolean;
  generateEmbeddings?: boolean;
  embeddingsBatchSize?: number;
}

/**
 * Calculate optimal batch size based on system resources
 */
function calculateOptimalBatchSize(): number {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const cpus = os.cpus().length;

  console.log('🖥️  System Resources:');
  console.log(`  • CPU Cores: ${cpus}`);
  console.log(`  • Total Memory: ${(totalMem / 1024 / 1024 / 1024).toFixed(2)} GB`);
  console.log(`  • Free Memory: ${(freeMem / 1024 / 1024 / 1024).toFixed(2)} GB`);

  // Base batch size
  let batchSize = 20;

  // Adjust based on memory (conservative: 100MB per batch of embeddings approx)
  // If we have > 8GB free, we can go big
  if (freeMem > 8 * 1024 * 1024 * 1024) {
    batchSize = 100;
  } else if (freeMem > 4 * 1024 * 1024 * 1024) {
    batchSize = 50;
  } else if (freeMem > 2 * 1024 * 1024 * 1024) {
    batchSize = 30;
  } else {
    batchSize = 10; // Low memory mode
  }

  // Adjust based on CPU (more cores = can handle more parallel processing if we were parallelizing)
  // For embeddings, batch size also affects inference speed.
  // MiniLM is small, so we can increase batch size on better CPUs.
  if (cpus >= 16) {
    batchSize = Math.min(batchSize * 2, 200);
  } else if (cpus >= 8) {
    batchSize = Math.min(batchSize * 1.5, 150);
  }

  console.log(`⚡ Optimized Batch Size: ${Math.floor(batchSize)}`);
  return Math.floor(batchSize);
}

async function main(options: IndexOptions = {}) {
  console.log('🚀 Starting Advanced Documentation Indexing...\n');

  // Ensure data directory exists
  const dataDir = join(__dirname, '..', 'data');
  await mkdir(dataDir, { recursive: true });

  const dbPath = join(dataDir, 'mcmodding-docs.db');
  const store = new DocumentStore(dbPath);

  try {
    // Get URLs to crawl
    let urls: string[];
    if (options.useSitemap) {
      console.log('📡 Fetching URLs from sitemap...');
      urls = [];
      urls.push(...(await getFabricWikiUrlsFromSitemap()));
      urls.push(...(await getFabricUrlsFromSitemap()));
      urls.push(...(await getNeoforgeUrlsFromSitemap()));

      if (urls.length === 0) {
        console.log('⚠️  Sitemap fetch failed, falling back to static list');
        urls = getFabricDocumentationUrls();
      } else {
        console.log(`✅ Fetched ${urls.length} URLs from sitemap`);
      }
    } else {
      urls = getFabricDocumentationUrls();
    }

    console.log(`📋 Found ${urls.length} documentation pages to index\n`);

    // Initialize crawler with progress tracking
    const crawler = new DocumentCrawler({
      maxConcurrency: 3,
      delayMs: 1000,
      retryAttempts: 3,
    });

    crawler.setProgressCallback((progress) => {
      const percent = Math.round((progress.completed / progress.total) * 100);
      const eta = progress.estimatedTimeRemaining
        ? ` | ETA: ${Math.round(progress.estimatedTimeRemaining)}s`
        : '';

      process.stdout.write(
        `\r⏳ Progress: ${progress.completed}/${progress.total} (${percent}%) | Failed: ${progress.failed}${eta}  `
      );
    });

    // Crawl all pages
    console.log('🕷️  Crawling documentation...');
    const documents = await crawler.crawlAll(urls);
    console.log(`\n✅ Successfully crawled ${documents.length} pages\n`);

    // Initialize chunker
    const chunker = new DocumentChunker({
      maxChunkSize: 1000,
      overlapSize: 100,
      preserveCodeBlocks: true,
    });

    // Process and store documents
    console.log('💾 Storing documents and creating search indexes...');
    let processedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let totalChunksToEmbed = 0;

    // Track chunks for embedding in batches
    let pendingChunks: Array<{ id: string; content: string; documentId: number }> = [];
    let embeddingGen: EmbeddingGenerator | null = null;

    // Initialize embedding generator early if needed
    if (options.generateEmbeddings) {
      embeddingGen = new EmbeddingGenerator();
      await embeddingGen.initialize();
    }

    // Calculate optimal batch size if not provided
    const embeddingBatchSize = options.embeddingsBatchSize || calculateOptimalBatchSize();

    // Helper function to process pending embeddings
    async function processEmbeddingBatch() {
      if (!options.generateEmbeddings || pendingChunks.length === 0 || !embeddingGen) {
        return;
      }

      const batch = pendingChunks;
      pendingChunks = []; // Clear for next batch

      const batchTexts = batch.map((c) => c.content);
      // Pass the optimized batch size to the generator
      const batchEmbeddings = await embeddingGen.generateEmbeddings(batchTexts, embeddingBatchSize);

      const embeddings: Array<{ chunkId: string; embedding: number[] }> = [];
      for (let j = 0; j < batch.length; j++) {
        embeddings.push({
          chunkId: batch[j]!.id,
          embedding: batchEmbeddings[j]!,
        });
      }

      // Store embeddings immediately to free memory
      store.storeEmbeddings(embeddings, 'Xenova/all-MiniLM-L6-v2');

      // Clear arrays explicitly
      batchTexts.length = 0;
      embeddings.length = 0;

      // Force garbage collection hint aggressively
      if (global.gc) {
        global.gc();
      }

      // Yield to event loop
      await new Promise((resolve) => setImmediate(resolve));
    }

    for (const doc of documents) {
      try {
        // Check if document needs updating (incremental mode)
        if (options.incremental && !options.force) {
          if (!store.needsUpdate(doc.url, doc.hash)) {
            skippedCount++;
            continue;
          }
        }

        // Store document
        const documentId = store.storeDocument(doc);

        // Create and store chunks
        const chunks = chunker.chunkDocument(doc);
        store.storeChunks(chunks, documentId);

        // Collect chunks for embedding generation (but process in small batches)
        if (options.generateEmbeddings) {
          for (const chunk of chunks) {
            pendingChunks.push({
              id: chunk.id,
              content: chunk.content,
              documentId,
            });
            totalChunksToEmbed++;

            // Process embedding batch when size threshold reached
            if (pendingChunks.length >= embeddingBatchSize) {
              await processEmbeddingBatch();
            }
          }
        }

        updatedCount++;
        processedCount++;

        // Progress indicator
        process.stdout.write(
          `\r  Processed: ${processedCount}/${documents.length} | Updated: ${updatedCount} | Skipped: ${skippedCount}  `
        );
      } catch (error) {
        console.error(`\n❌ Error processing ${doc.url}:`, error);
      }
    }

    // Process remaining chunks
    if (pendingChunks.length > 0) {
      await processEmbeddingBatch();
    }

    console.log('\n');

    // Log embedding completion
    if (options.generateEmbeddings && totalChunksToEmbed > 0) {
      console.log(`✅ Embeddings generated and stored for ${totalChunksToEmbed} chunks\n`);
    }

    // Update timestamp
    store.updateTimestamp();

    // Show statistics
    console.log('📊 Indexing Statistics:');
    const stats = store.getStats();
    console.log(`  • Total Documents: ${stats.totalDocuments}`);
    console.log(`  • Total Sections: ${stats.totalSections}`);
    console.log(`  • Total Code Blocks: ${stats.totalCodeBlocks}`);
    console.log(`  • Fabric Docs: ${stats.loaders.fabric}`);
    console.log(`  • NeoForge Docs: ${stats.loaders.neoforge}`);
    console.log(`  • Shared Docs: ${stats.loaders.shared}`);

    // Show version breakdown
    const versions = store.getAllVersions();
    if (versions.length > 0) {
      console.log(`  • Minecraft Versions: ${versions.join(', ')}`);
    }

    // Show embedding stats
    if (options.generateEmbeddings) {
      const embStats = store.getEmbeddingStats();
      console.log(`  • Total Embeddings: ${embStats.totalEmbeddings}`);
      if (embStats.models.length > 0) {
        console.log(
          `  • Embedding Models: ${embStats.models.map((m) => `${m.model} (${m.count})`).join(', ')}`
        );
      }
    }

    console.log(`  • Last Updated: ${stats.lastUpdated.toISOString()}`);
    console.log(`  • Index Version: ${stats.version}`);

    console.log(`\n✨ Indexing complete!`);
    console.log(`   Updated: ${updatedCount} documents`);
    console.log(`   Skipped: ${skippedCount} documents (no changes)`);
    console.log(`   Database: ${dbPath}\n`);
  } catch (error) {
    console.error('\n💥 Indexing failed:', error);
    process.exit(1);
  } finally {
    store.close();
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const options: IndexOptions = {
  force: args.includes('--force') || args.includes('-f'),
  incremental: args.includes('--incremental') || args.includes('-i'),
  useSitemap: args.includes('--sitemap') || args.includes('-s'),
  generateEmbeddings: args.includes('--embeddings') || args.includes('-e'),
  embeddingsBatchSize: 100,
};

// Show help
if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: npm run index-docs [options]');
  console.log('');
  console.log('Options:');
  console.log('  -f, --force         Force full re-index (ignore hashes)');
  console.log('  -i, --incremental   Incremental update (skip unchanged)');
  console.log('  -s, --sitemap       Fetch URLs from sitemap.xml');
  console.log('  -e, --embeddings    Generate semantic embeddings');
  console.log('  -h, --help          Show this help message');
  console.log('');
  console.log('Examples:');
  console.log('  npm run index-docs                          # Standard index');
  console.log('  npm run index-docs -- --incremental         # Update only changed pages');
  console.log('  npm run index-docs -- --sitemap             # Use sitemap for URLs');
  console.log('  npm run index-docs -- --embeddings          # Generate embeddings');
  console.log('  npm run index-docs -- -i -s -e              # All features');
  process.exit(0);
}

// Run indexer
console.log('Configuration:');
console.log(`  • Force re-index: ${options.force ? 'Yes' : 'No'}`);
console.log(`  • Incremental: ${options.incremental ? 'Yes' : 'No'}`);
console.log(`  • Use sitemap: ${options.useSitemap ? 'Yes' : 'No'}`);
console.log(`  • Generate embeddings: ${options.generateEmbeddings ? 'Yes' : 'No'}`);
console.log('');

main(options).catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
