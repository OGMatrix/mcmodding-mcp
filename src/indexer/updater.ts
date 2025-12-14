/**
 * Auto-update system for documentation
 * Checks for updates and manages incremental indexing
 */

import { DocumentStore } from './store.js';
import { DocumentCrawler, getFabricDocumentationUrls } from './crawler.js';
import { DocumentChunker } from './chunker.js';
import { getFabricUrlsFromSitemap } from './sitemap.js';
import type { IndexStats } from './types.js';

export interface UpdateCheckResult {
  needsUpdate: boolean;
  reason: string;
  stats: IndexStats;
  age: number; // Age in milliseconds
  staleness: 'fresh' | 'recent' | 'stale' | 'very-stale';
}

export interface UpdateOptions {
  force?: boolean;
  maxAge?: number; // Maximum age in milliseconds
  useSitemap?: boolean;
  verbose?: boolean;
}

export class DocumentUpdater {
  private store: DocumentStore;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    this.store = new DocumentStore(dbPath);
  }

  /**
   * Check if documentation needs updating
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async checkForUpdates(): Promise<UpdateCheckResult> {
    const stats = this.store.getStats();
    const now = Date.now();
    const age = now - stats.lastUpdated.getTime();

    // Calculate staleness
    const ONE_DAY = 24 * 60 * 60 * 1000;
    let staleness: 'fresh' | 'recent' | 'stale' | 'very-stale';
    let needsUpdate = false;
    let reason = '';

    if (age < ONE_DAY) {
      staleness = 'fresh';
      reason = 'Documentation is fresh (< 1 day old)';
    } else if (age < 7 * ONE_DAY) {
      staleness = 'recent';
      reason = 'Documentation is recent (< 7 days old)';
    } else if (age < 30 * ONE_DAY) {
      staleness = 'stale';
      needsUpdate = true;
      reason = 'Documentation is stale (> 7 days old)';
    } else {
      staleness = 'very-stale';
      needsUpdate = true;
      reason = 'Documentation is very stale (> 30 days old)';
    }

    // Check if database is empty
    if (stats.totalDocuments === 0) {
      needsUpdate = true;
      reason = 'Database is empty';
      staleness = 'very-stale';
    }

    return {
      needsUpdate,
      reason,
      stats,
      age,
      staleness,
    };
  }

  /**
   * Perform automatic update check and notify
   */
  async autoUpdateCheck(options: UpdateOptions = {}): Promise<void> {
    const maxAge = options.maxAge || 7 * 24 * 60 * 60 * 1000; // 7 days default

    const result = await this.checkForUpdates();

    if (!result.needsUpdate && result.age < maxAge) {
      if (options.verbose) {
        console.error('✅ Documentation is up to date');
        console.error(`   Last updated: ${result.stats.lastUpdated.toISOString()}`);
        console.error(`   Age: ${this.formatAge(result.age)}`);
      }
      return;
    }

    // Display update notification
    console.error('');
    console.error('╔════════════════════════════════════════════════════════════╗');
    console.error('║  📢 Documentation Update Available                         ║');
    console.error('╚════════════════════════════════════════════════════════════╝');
    console.error('');
    console.error(`  Status: ${result.staleness}`);
    console.error(`  Reason: ${result.reason}`);
    console.error(`  Last updated: ${result.stats.lastUpdated.toISOString()}`);
    console.error(`  Age: ${this.formatAge(result.age)}`);
    console.error('');
    console.error('  To update documentation, run:');
    console.error('    npm run index-docs -- --incremental');
    console.error('');
    console.error('  Or force a full re-index:');
    console.error('    npm run index-docs -- --force');
    console.error('');
  }

  /**
   * Perform incremental update
   */
  async performIncrementalUpdate(options: UpdateOptions = {}): Promise<void> {
    console.error('🔄 Starting incremental documentation update...\n');

    // Get URLs
    let urls: string[];
    if (options.useSitemap) {
      console.error('📡 Fetching URLs from sitemap...');
      urls = await getFabricUrlsFromSitemap();
      if (urls.length === 0) {
        console.error('⚠️  Sitemap fetch failed, using static list');
        urls = getFabricDocumentationUrls();
      }
    } else {
      urls = getFabricDocumentationUrls();
    }

    console.error(`📋 Found ${urls.length} URLs to check\n`);

    // Get existing URLs
    const existingUrls = this.store.getAllUrls();
    const existingSet = new Set(existingUrls);

    // Find new URLs
    const newUrls = urls.filter((url) => !existingSet.has(url));

    if (newUrls.length > 0) {
      console.error(`🆕 Found ${newUrls.length} new pages`);
    }

    // Initialize crawler
    const crawler = new DocumentCrawler({
      maxConcurrency: 3,
      delayMs: 1000,
      retryAttempts: 3,
    });

    let updatedCount = 0;
    let skippedCount = 0;
    let newCount = 0;

    // Crawl and check for updates
    console.error('🕷️  Checking for updates...\n');

    for (let i = 0; i < urls.length; i++) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const url = urls[i]!;

      try {
        const doc = await crawler.crawlPage(url);

        // Check if needs update
        if (!this.store.needsUpdate(url, doc.hash) && !options.force) {
          skippedCount++;
          process.stdout.write(
            `\r  Progress: ${i + 1}/${urls.length} | Updated: ${updatedCount} | New: ${newCount} | Skipped: ${skippedCount}  `
          );
          continue;
        }

        // Store document
        const documentId = this.store.storeDocument(doc);

        // Create and store chunks
        const chunker = new DocumentChunker();
        const chunks = chunker.chunkDocument(doc);
        this.store.storeChunks(chunks, documentId);

        if (existingSet.has(url)) {
          updatedCount++;
        } else {
          newCount++;
        }

        process.stdout.write(
          `\r  Progress: ${i + 1}/${urls.length} | Updated: ${updatedCount} | New: ${newCount} | Skipped: ${skippedCount}  `
        );

        // Rate limiting
        if (i < urls.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } catch (error) {
        console.error(`\n❌ Failed to update ${url}:`, error);
      }
    }

    console.error('\n');

    // Update timestamp
    this.store.updateTimestamp();

    // Show results
    console.error('✅ Incremental update complete!\n');
    console.error(`   Updated: ${updatedCount} documents`);
    console.error(`   New: ${newCount} documents`);
    console.error(`   Skipped: ${skippedCount} documents (no changes)\n`);

    const stats = this.store.getStats();
    console.error('📊 Current Index Statistics:');
    console.error(`   Total Documents: ${stats.totalDocuments}`);
    console.error(`   Total Sections: ${stats.totalSections}`);
    console.error(`   Total Code Blocks: ${stats.totalCodeBlocks}`);
    console.error(`   Last Updated: ${stats.lastUpdated.toISOString()}\n`);
  }

  /**
   * Format age in human-readable format
   */
  private formatAge(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days} day${days !== 1 ? 's' : ''}`;
    }
    if (hours > 0) {
      return `${hours} hour${hours !== 1 ? 's' : ''}`;
    }
    if (minutes > 0) {
      return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
    }
    return `${seconds} second${seconds !== 1 ? 's' : ''}`;
  }

  /**
   * Close the database
   */
  close(): void {
    this.store.close();
  }
}

/**
 * Background update service
 * Runs periodic checks in the background
 */
export class BackgroundUpdateService {
  private updater: DocumentUpdater;
  private checkInterval: number;
  private intervalId: NodeJS.Timeout | null = null;
  private running = false;

  constructor(dbPath: string, checkInterval: number = 24 * 60 * 60 * 1000) {
    // Default: check every 24 hours
    this.updater = new DocumentUpdater(dbPath);
    this.checkInterval = checkInterval;
  }

  /**
   * Start the background service
   */
  start(): void {
    if (this.running) return;

    this.running = true;

    // Initial check
    void this.performCheck();

    // Schedule periodic checks
    this.intervalId = setInterval(() => {
      void this.performCheck();
    }, this.checkInterval);

    console.error('🔄 Background update service started');
    console.error(`   Check interval: ${this.checkInterval / 1000 / 60 / 60} hours`);
  }

  /**
   * Stop the background service
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.running = false;
    this.updater.close();

    console.error('⏹️  Background update service stopped');
  }

  /**
   * Perform update check
   */
  private async performCheck(): Promise<void> {
    try {
      await this.updater.autoUpdateCheck({ verbose: false });
    } catch (error) {
      console.error('❌ Background update check failed:', error);
    }
  }

  /**
   * Check if service is running
   */
  isRunning(): boolean {
    return this.running;
  }
}

/**
 * Update scheduler with configurable strategies
 */
export interface ScheduleOptions {
  strategy: 'startup' | 'periodic' | 'manual' | 'hybrid';
  checkIntervalHours?: number;
  autoUpdate?: boolean;
  maxAgeHours?: number;
}

export class UpdateScheduler {
  private updater: DocumentUpdater;
  private backgroundService: BackgroundUpdateService | null = null;
  private options: ScheduleOptions;

  constructor(dbPath: string, options: ScheduleOptions) {
    this.updater = new DocumentUpdater(dbPath);
    this.options = options;
  }

  /**
   * Initialize the scheduler
   */
  async initialize(): Promise<void> {
    switch (this.options.strategy) {
      case 'startup':
        await this.handleStartupCheck();
        break;

      case 'periodic':
        this.startPeriodicChecks();
        break;

      case 'hybrid':
        await this.handleStartupCheck();
        this.startPeriodicChecks();
        break;

      case 'manual':
        // Do nothing, user controls updates
        break;
    }
  }

  /**
   * Handle startup check
   */
  private async handleStartupCheck(): Promise<void> {
    const maxAge = (this.options.maxAgeHours || 168) * 60 * 60 * 1000; // Default: 7 days

    const result = await this.updater.checkForUpdates();

    if (result.needsUpdate || result.age > maxAge) {
      if (this.options.autoUpdate) {
        console.error('🔄 Auto-updating documentation...');
        await this.updater.performIncrementalUpdate({
          useSitemap: true,
          verbose: true,
        });
      } else {
        await this.updater.autoUpdateCheck({ maxAge });
      }
    }
  }

  /**
   * Start periodic background checks
   */
  private startPeriodicChecks(): void {
    const intervalMs = (this.options.checkIntervalHours || 24) * 60 * 60 * 1000;

    this.backgroundService = new BackgroundUpdateService(this.updater['dbPath'], intervalMs);
    this.backgroundService.start();
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (this.backgroundService) {
      this.backgroundService.stop();
    }
    this.updater.close();
  }
}
