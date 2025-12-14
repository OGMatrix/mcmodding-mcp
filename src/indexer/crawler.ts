/**
 * Advanced documentation crawler with rate limiting, retry logic, and progress tracking
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */

import { load, CheerioAPI } from 'cheerio';
import fetch from 'node-fetch';
import { createHash } from 'crypto';
import { detectMinecraftVersion } from './sitemap.js';
import type {
  DocumentPage,
  DocumentSection,
  CodeBlock,
  CrawlerOptions,
  IndexerProgress,
} from './types.js';

/**
 * CSS selectors for elements to remove before content extraction
 * These are navigation, UI, and non-content elements
 */
const REMOVE_SELECTORS = [
  // Navigation
  'nav',
  'header',
  'footer',
  '.nav',
  '.navigation',
  '.navbar',
  '.menu',
  '.sidebar',
  '.aside',
  'aside',

  // Breadcrumbs & TOC
  '.breadcrumb',
  '.breadcrumbs',
  '.toc',
  '.table-of-contents',
  '#toc',

  // Language selectors (VitePress/VuePress patterns)
  '.VPLocalNav',
  '.VPNavBar',
  '.VPSidebar',
  '.VPFooter',
  '.VPDocFooter',
  '.VPLocalSearchBox',
  '.VPFlyout',
  '.VPNavBarMenu',
  '.VPNavBarMenuGroup',
  '.VPNavBarMenuLink',
  '.VPNavBarSocialLinks',
  '.VPNavBarTitle',
  '.VPNavBarTranslations', // Language selector!
  '.VPNavBarAppearance',
  '.VPNavScreenTranslations',
  '.VPMenu',
  '.appearance', // Theme switcher
  '.social-links',
  '[class*="language-selector"]',
  '[class*="lang-switch"]',
  '[class*="locale-"]',

  // Search UI
  '.search',
  '.search-box',
  '#search',
  '[role="search"]',

  // Edit/feedback links
  '.edit-link',
  '.page-edit',
  '.last-updated',
  '.contributors',
  '.prev-next',
  '.pager',

  // Misc UI
  '.copy-code-button',
  '.line-numbers',
  '.vp-code-group',
  'button',
  'script',
  'style',
  'noscript',
  'iframe',
];

/**
 * Text patterns to strip from extracted content
 * These catch any remaining UI text that wasn't removed by selectors
 */
const NOISE_TEXT_PATTERNS: RegExp[] = [
  // Language selector text with flags
  /🇺🇸\s*English\s*\([^)]*\)/gi,
  /🇨🇿\s*Čeština\s*\([^)]*\)/gi,
  /🇩🇪\s*Deutsch\s*\([^)]*\)/gi,
  /🇬🇷\s*Ελληνικά\s*\([^)]*\)/gi,
  /🇪🇸\s*Español\s*\([^)]*\)/gi,
  /🇫🇷\s*Français\s*\([^)]*\)/gi,
  /🇮🇹\s*Italiano\s*\([^)]*\)/gi,
  /🇯🇵\s*日本語\s*\([^)]*\)/gi,
  /🇰🇷\s*한국어\s*\([^)]*\)/gi,
  /🇵🇱\s*Polski\s*\([^)]*\)/gi,
  /🇧🇷\s*Português\s*\([^)]*\)/gi,
  /🇷🇺\s*Русский\s*\([^)]*\)/gi,
  /🇺🇦\s*Українська\s*\([^)]*\)/gi,
  /🇻🇳\s*Tiếng Việt\s*\([^)]*\)/gi,

  // Generic flag + language patterns
  /[\u{1F1E6}-\u{1F1FF}]{2}\s*[A-Za-zÀ-ÿ\u0400-\u04FF\u0370-\u03FF\u4E00-\u9FFF\uAC00-\uD7AF]+\s*\([^)]+\)/gu,

  // Long language selector sequences (catches "Search🇺🇸 English...Tiếng Việt (Việt...")
  /Search[\s\S]{0,50}?🇺🇸[\s\S]*?(?:Việt Nam|Việt\)|한국\)|日本\)|Россия\)|Brasil\)|Polska\)|Україна\))/gi,

  // Navigation text patterns
  /On this page/gi,
  /Table of Contents/gi,
  /Skip to content/gi,
  /Edit this page/gi,
  /Last updated:/gi,
  /Contributors:/gi,

  // Theme/appearance UI
  /Switch to dark theme/gi,
  /Switch to light theme/gi,
  /Toggle dark mode/gi,
  /Appearance/gi,

  // Copy button text
  /Copy code/gi,
  /Copied!/gi,
];

/**
 * Clean text by removing UI noise patterns
 */
function cleanText(text: string): string {
  let cleaned = text;

  for (const pattern of NOISE_TEXT_PATTERNS) {
    cleaned = cleaned.replace(pattern, '');
  }

  // Normalize whitespace
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  cleaned = cleaned.replace(/[ \t]+/g, ' ');
  cleaned = cleaned.replace(/^\s+|\s+$/gm, '');

  return cleaned.trim();
}

export class DocumentCrawler {
  private options: CrawlerOptions;
  private progress: IndexerProgress;
  private queue: string[] = [];
  private activeRequests = 0;
  private onProgress?: (progress: IndexerProgress) => void;

  constructor(options: Partial<CrawlerOptions> = {}) {
    this.options = {
      maxConcurrency: 3,
      delayMs: 1000,
      retryAttempts: 3,
      retryDelayMs: 2000,
      userAgent: 'mcmodding-mcp-indexer/0.1.0',
      timeout: 30000,
      ...options,
    };

    this.progress = {
      total: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
      startTime: new Date(),
    };
  }

  /**
   * Set progress callback
   */
  setProgressCallback(callback: (progress: IndexerProgress) => void) {
    this.onProgress = callback;
  }

  /**
   * Crawl multiple URLs with concurrency control
   */
  async crawlAll(urls: string[]): Promise<DocumentPage[]> {
    this.queue = [...urls];
    this.progress.total = urls.length;
    this.progress.completed = 0;
    this.progress.failed = 0;
    this.progress.skipped = 0;
    this.progress.startTime = new Date();

    const results: DocumentPage[] = [];
    const promises: Promise<void>[] = [];

    // Start concurrent workers
    for (let i = 0; i < this.options.maxConcurrency; i++) {
      promises.push(this.worker(results));
    }

    await Promise.all(promises);
    return results;
  }

  /**
   * Worker that processes URLs from the queue
   */
  private async worker(results: DocumentPage[]) {
    while (this.queue.length > 0) {
      const url = this.queue.shift();
      if (!url) break;

      this.activeRequests++;
      this.progress.currentUrl = url;
      this.updateProgress();

      try {
        const doc = await this.crawlWithRetry(url);
        results.push(doc);
        this.progress.completed++;
      } catch (error) {
        console.error(`Failed to crawl ${url}:`, error);
        this.progress.failed++;
      } finally {
        this.activeRequests--;
        this.updateProgress();

        // Rate limiting delay
        if (this.queue.length > 0) {
          await this.sleep(this.options.delayMs);
        }
      }
    }
  }

  /**
   * Crawl with retry logic
   */
  private async crawlWithRetry(url: string): Promise<DocumentPage> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.options.retryAttempts; attempt++) {
      try {
        return await this.crawlPage(url);
      } catch (error) {
        lastError = error as Error;
        if (attempt < this.options.retryAttempts - 1) {
          console.warn(`Retry ${attempt + 1}/${this.options.retryAttempts} for ${url}`);
          await this.sleep(this.options.retryDelayMs * (attempt + 1));
        }
      }
    }

    throw lastError || new Error('Failed to crawl page after retries');
  }

  /**
   * Crawl a single documentation page
   */
  async crawlPage(url: string): Promise<DocumentPage> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeout);

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': this.options.userAgent,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const html = await response.text();
      const $ = load(html);

      return this.parsePage(url, html, $);
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Parse HTML into structured document
   */
  private parsePage(url: string, html: string, $: CheerioAPI): DocumentPage {
    // Extract title
    const title = this.extractTitle($);

    // Extract category from URL
    const category = this.extractCategory(url);

    // Extract sections
    const sections = this.extractSections($);

    // Extract all text content for searching
    const content = this.extractContent($);

    // Calculate hash for change detection
    const hash = this.calculateHash(html);

    // Extract metadata
    const metadata = {
      crawledAt: new Date(),
      tags: this.extractTags($),
      difficulty: this.detectDifficulty($, content),
    };

    // Detect loader from URL
    const loader = this.detectLoader(url);

    // Detect Minecraft version
    const minecraftVersion = detectMinecraftVersion(url, content);

    return {
      url,
      title,
      content,
      rawHtml: html,
      category,
      loader,
      minecraftVersion,
      sections,
      metadata,
      hash,
    };
  }

  /**
   * Extract page title
   */
  private extractTitle($: CheerioAPI): string {
    // Try multiple selectors
    const selectors = ['.page .sectionedit1', 'h1', 'title', '.page-title', 'header h1'];

    for (const selector of selectors) {
      const text = $(selector).first().text().trim();
      if (text) return text;
    }

    return 'Untitled';
  }

  /**
   * Extract category from URL
   */
  private extractCategory(url: string): string {
    const match = url.match(
      /https?:\/\/[^/]+\/(?:.*\/)?(?:(?:\d+(?:\.\d+)*|develop)\/([^/]+)|([^/:\\s]+):)/
    );
    if (match) {
      return match[1] || 'general';
    }
    return 'general';
  }

  /**
   * Extract structured sections from the page
   * Handles both general docs (h1-h6 tags) and wiki.fabricmc.net structure (sectionedit classes)
   */
  private extractSections($: CheerioAPI): DocumentSection[] {
    const sections: DocumentSection[] = [];

    // Remove UI elements first (work on a clone to not affect other extraction)
    for (const selector of REMOVE_SELECTORS) {
      $(selector).remove();
    }

    // Try multiple selectors for main content
    const mainContent =
      $('main').first().length > 0
        ? $('main').first()
        : $('#dokuwiki__content .page.group').first().length > 0
          ? $('#dokuwiki__content .page.group').first()
          : $('article').first().length > 0
            ? $('article').first()
            : $('.markdown-body').first().length > 0
              ? $('.markdown-body').first()
              : $('.content-container').first().length > 0
                ? $('.content-container').first()
                : $('.content').first().length > 0
                  ? $('.content').first()
                  : $('#content').first().length > 0
                    ? $('#content').first()
                    : $('body').first();

    if (!mainContent.length) {
      return sections;
    }

    // Check if this is wiki.fabricmc.net structure (sectionedit classes)
    const wikiSections = mainContent.find('[class*="sectionedit"]');

    if (wikiSections.length > 0) {
      // Wiki structure: sectionedit1, sectionedit2, etc. with level1, level2, etc.
      wikiSections.each((index: number, elem: unknown) => {
        const $heading = $(elem as any);
        const heading = cleanText($heading.text().trim());

        // Extract level from class (e.g., "sectionedit2" -> level 2)
        const classAttr = $heading.attr('class') || '';
        const levelMatch = classAttr.match(/sectionedit(\d+)/);
        const level = levelMatch ? parseInt(levelMatch[1]?.toString() || '', 10) : 1;

        // Find the next sibling div with class starting with "level"
        let $contentDiv = $heading.next();
        while ($contentDiv.length > 0) {
          const divClass = $contentDiv.attr('class') || '';
          if (divClass.startsWith('level')) {
            break;
          }
          $contentDiv = $contentDiv.next();
        }

        if (!$contentDiv.length) {
          return; // Skip if no content div found
        }

        // Extract content and code blocks from the level div
        const content: string[] = [];
        const codeBlocks: CodeBlock[] = [];

        // Process all children of the level div
        $contentDiv.children().each((_: number, child: unknown) => {
          const $child = $(child as any);
          const childTagName = (child as { tagName?: string }).tagName?.toLowerCase();

          // Check if this element contains code
          if (childTagName === 'pre' || $child.find('pre').length > 0) {
            const blocks = this.extractCodeBlocks($, $child);
            codeBlocks.push(...blocks);
          } else {
            // Extract text content and clean it
            const rawText = $child.text().trim();
            const text = cleanText(rawText);
            if (text && text.length > 0) {
              content.push(text);
            }
          }
        });

        // Only add section if it has meaningful content
        const sectionContent = content.join('\n\n');
        if (heading || sectionContent || codeBlocks.length > 0) {
          sections.push({
            heading,
            level,
            content: sectionContent,
            codeBlocks,
            order: index,
          });
        }
      });

      return sections;
    }

    // Standard structure: h1-h6 headings
    const headings = mainContent.find('h1, h2, h3, h4, h5, h6');

    if (headings.length === 0) {
      // No headings found, create a single section with all content
      const rawText = mainContent.text().trim();
      const allText = cleanText(rawText);
      if (allText) {
        sections.push({
          heading: 'Content',
          level: 1,
          content: allText,
          codeBlocks: this.extractCodeBlocks($, mainContent),
          order: 0,
        });
      }
      return sections;
    }

    // Process each heading and extract content until next heading
    headings.each((index: number, elem: unknown) => {
      const $heading = $(elem as any);
      const heading = cleanText($heading.text().trim());
      const tagName = (elem as { tagName?: string }).tagName?.toLowerCase() || 'h2';
      const level = parseInt(tagName[1] || '2', 10);

      // Collect content between this heading and the next
      const content: string[] = [];
      const codeBlocks: CodeBlock[] = [];

      // Get all siblings after this heading until the next heading
      let $current = $heading.next();
      while ($current.length > 0) {
        const currentTagName = ($current.get(0) as any)?.tagName?.toLowerCase();

        // Stop if we hit another heading
        if (currentTagName && currentTagName.match(/^h[1-6]$/)) {
          break;
        }

        // Check if this element or its children contain code
        if (currentTagName === 'pre' || $current.find('pre').length > 0) {
          const blocks = this.extractCodeBlocks($, $current);
          codeBlocks.push(...blocks);
        } else {
          // Extract text content and clean it
          const rawText = $current.text().trim();
          const text = cleanText(rawText);
          if (text && text.length > 0) {
            content.push(text);
          }
        }

        $current = $current.next();
      }

      // Only add section if it has meaningful content
      const sectionContent = content.join('\n\n');
      if (heading || sectionContent || codeBlocks.length > 0) {
        sections.push({
          heading,
          level,
          content: sectionContent,
          codeBlocks,
          order: index,
        });
      }
    });

    return sections;
  }

  /**
   * Extract code blocks from an element
   * Handles multiple wiki formats:
   * 1. Standard: <pre><code>...</code></pre>
   * 2. Wiki numbered: <pre class="code java"><ol><li><div>...</div></li></ol></pre>
   * 3. Wiki direct: <pre class="code java">...code...</pre>
   *
   * @param $ - CheerioAPI instance for element manipulation
   * @param $elem - The element to extract code blocks from (can be a <pre> itself or a container)
   */
  private extractCodeBlocks($: CheerioAPI, $elem: any): CodeBlock[] {
    const blocks: CodeBlock[] = [];

    // Collect all <pre> elements to process
    // IMPORTANT: Handle case where $elem itself is a <pre> element
    // .find() only searches descendants, not the element itself
    const preList: any[] = [];

    if ($elem.is('pre')) {
      // $elem itself is a <pre> element - add it to the list
      preList.push($elem);
    }

    // Also find any <pre> elements within $elem (for container elements)
    $elem.find('pre').each((_: number, el: any) => {
      preList.push($(el));
    });

    for (const pre of preList) {
      const codeElem = pre.find('code');

      // Extract code text - handle different wiki structures
      let code: string;
      const olElement = pre.find('ol');

      if (olElement.length > 0) {
        // Wiki structure with numbered list: <pre><ol><li><div>code</div></li></ol></pre>
        // Extract text from each li element to preserve line structure
        const lines: string[] = [];
        olElement.find('li').each((_: number, li: any) => {
          // Now we can use $ from the parent scope
          const lineText = $(li).text();
          lines.push(lineText);
        });
        code = lines.join('\n').trim();
      } else if (codeElem.length > 0) {
        // Standard structure: <pre><code>...</code></pre>
        code = codeElem.text().trim();
      } else {
        // Direct content in pre: <pre class="code java">...code...</pre>
        code = pre.text().trim();
      }

      if (!code) continue;

      // Try to detect language from class attributes
      // Check both code element and pre element
      const codeClass = codeElem.attr('class') || '';
      const preClass = pre.attr('class') || '';
      const className = codeClass || preClass;

      // Try multiple language detection patterns:
      // 1. "language-java" (standard markdown/prism format)
      // 2. "code java" (wiki format)
      // 3. "java" (simple format)
      let language = 'text';

      const langMatch =
        className.match(/language-(\w+)/) || // language-java
        className.match(/\bcode\s+(\w+)/) || // code java
        className.match(/^(\w+)$/); // java

      if (langMatch && langMatch[1]) {
        language = langMatch[1];
        // Don't use "code" as a language - fall back to text
        if (language === 'code') {
          language = 'text';
        }
      }

      // Look for caption in parent figure element
      const figure = pre.closest('figure');
      const caption =
        figure.length > 0 ? figure.find('figcaption').text().trim() || undefined : undefined;

      blocks.push({
        language,
        code,
        caption,
      });
    }

    return blocks;
  }

  /**
   * Extract clean text content
   */
  private extractContent($: CheerioAPI): string {
    // Clone the document to avoid modifying original
    const $clone = $.root().clone();
    const $doc = load($clone.html() || '');

    // Remove all UI/navigation elements
    for (const selector of REMOVE_SELECTORS) {
      $doc(selector).remove();
    }

    // Find main content area
    const main =
      $doc('main').first().length > 0
        ? $doc('main').first()
        : $doc('article').first().length > 0
          ? $doc('article').first()
          : $doc('.content, .markdown-body, #content').first().length > 0
            ? $doc('.content, .markdown-body, #content').first()
            : $doc('#dokuwiki__content .page.group').first().length > 0
              ? $doc('#dokuwiki__content .page.group').first()
              : $doc('body').first();

    // Get text and clean it
    const rawText = main.text();
    return cleanText(rawText);
  }

  /**
   * Extract tags/keywords from the page
   */
  private extractTags($: CheerioAPI): string[] {
    const tags: string[] = [];

    // From meta tags
    $('meta[name="keywords"]').each((_: number, elem: unknown) => {
      const content = $(elem as any).attr('content');
      if (content) {
        tags.push(...content.split(',').map((t: string) => t.trim()));
      }
    });

    // From data attributes or classes
    $('[data-tags]').each((_: number, elem: unknown) => {
      const dataTags = $(elem as any).attr('data-tags');
      if (dataTags) {
        tags.push(...dataTags.split(',').map((t: string) => t.trim()));
      }
    });

    return [...new Set(tags)];
  }

  /**
   * Detect difficulty level from content
   */
  private detectDifficulty(
    _$: CheerioAPI,
    content: string
  ): 'beginner' | 'intermediate' | 'advanced' | undefined {
    const lower = content.toLowerCase();

    if (lower.includes('getting started') || lower.includes('introduction')) {
      return 'beginner';
    }
    if (lower.includes('advanced') || lower.includes('performance')) {
      return 'advanced';
    }
    if (lower.includes('tutorial')) {
      return 'beginner';
    }

    return undefined;
  }

  /**
   * Calculate content hash for change detection
   */
  private calculateHash(content: string): string {
    return createHash('sha256').update(content).digest('hex').substring(0, 16);
  }

  /**
   * Update progress and call callback
   */
  private updateProgress() {
    if (this.onProgress) {
      // Calculate estimated time remaining
      const elapsed = Date.now() - this.progress.startTime.getTime();
      const rate = this.progress.completed / (elapsed / 1000);
      const remaining = this.progress.total - this.progress.completed - this.progress.failed;
      this.progress.estimatedTimeRemaining = remaining / rate;

      this.onProgress({ ...this.progress });
    }
  }

  /**
   * Detect loader from URL
   */
  private detectLoader(url: string): 'fabric' | 'neoforge' | 'shared' {
    try {
      const parsed = new URL(url);
      // Check for fabricmc.net or its subdomains
      if (parsed.host === 'fabricmc.net' || parsed.host.endsWith('.fabricmc.net')) {
        return 'fabric';
      }
      if (parsed.host === 'neoforged.net' || parsed.host.endsWith('.neoforged.net')) {
        return 'neoforge';
      }
    } catch {
      // If parsing fails (possibly a relative URL), fallback to path-based detection
      // ignore
    }
    if (url.includes('/fabric/')) {
      return 'fabric';
    }
    if (url.includes('/neoforge/')) {
      return 'neoforge';
    }
    return 'shared';
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Get all Fabric documentation URLs to crawl
 */
export function getFabricDocumentationUrls(): string[] {
  // TODO: Implement sitemap parsing or recursive discovery
  // For now, return a comprehensive list of known pages

  const baseUrl = 'https://docs.fabricmc.net/develop';

  return [
    // Getting Started
    `${baseUrl}/`,
    `${baseUrl}/getting-started/introduction`,
    `${baseUrl}/getting-started/setting-up-a-development-environment`,
    `${baseUrl}/getting-started/creating-a-project`,
    `${baseUrl}/getting-started/project-structure`,
    `${baseUrl}/getting-started/launch-game`,

    // Items
    `${baseUrl}/items/first-item`,
    `${baseUrl}/items/custom-item-groups`,
    `${baseUrl}/items/custom-item-interactions`,
    `${baseUrl}/items/food`,
    `${baseUrl}/items/tools`,
    `${baseUrl}/items/armor`,
    `${baseUrl}/items/custom-armor`,

    // Blocks
    `${baseUrl}/blocks/first-block`,
    `${baseUrl}/blocks/block-state`,
    `${baseUrl}/blocks/block-entity`,
    `${baseUrl}/blocks/block-entity-renderer`,
    `${baseUrl}/blocks/mining-levels`,

    // Entities
    `${baseUrl}/entities/effects`,
    `${baseUrl}/entities/damage-types`,

    // Rendering
    `${baseUrl}/rendering/basic-concepts`,
    `${baseUrl}/rendering/draw-context`,
    `${baseUrl}/rendering/hud`,

    // Networking
    `${baseUrl}/networking/payload`,
    `${baseUrl}/networking/channels`,

    // Data Generation
    `${baseUrl}/data-generation/`,
    `${baseUrl}/data-generation/recipes`,
    `${baseUrl}/data-generation/loot-tables`,
    `${baseUrl}/data-generation/tags`,
    `${baseUrl}/data-generation/advancement`,
    `${baseUrl}/data-generation/model`,

    // Misc
    `${baseUrl}/commands/basics`,
    `${baseUrl}/commands/arguments`,
    `${baseUrl}/sounds/using-sounds`,
    `${baseUrl}/sounds/custom`,
    `${baseUrl}/codecs`,

    // Add more as needed
  ];
}
