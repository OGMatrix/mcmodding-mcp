/**
 * Smart document chunking for better search results
 * Splits documents into searchable chunks while preserving context
 */

import type { DocumentPage, DocumentSection, ChunkOptions } from './types.js';

export interface DocumentChunk {
  id: string;
  documentUrl: string;
  title: string;
  category: string;
  loader: string;
  chunkType: 'title' | 'section' | 'code' | 'full';
  content: string;
  codeLanguage?: string;
  sectionHeading?: string;
  sectionLevel?: number;
  order: number;
  metadata: {
    hasCode: boolean;
    wordCount: number;
    difficulty?: string;
    tags: string[];
  };
}

export class DocumentChunker {
  private options: ChunkOptions;

  constructor(options: Partial<ChunkOptions> = {}) {
    this.options = {
      maxChunkSize: 1000, // characters
      overlapSize: 100, // characters of overlap between chunks
      preserveCodeBlocks: true,
      minChunkSize: 50,
      ...options,
    };
  }

  /**
   * Chunk a document page into searchable pieces
   */
  chunkDocument(doc: DocumentPage): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    let order = 0;

    // Always create a title chunk for context
    chunks.push(this.createTitleChunk(doc, order++));

    // Chunk each section
    for (const section of doc.sections) {
      const sectionChunks = this.chunkSection(doc, section, order);
      chunks.push(...sectionChunks);
      order += sectionChunks.length;
    }

    // If no sections, create a single full-doc chunk
    if (doc.sections.length === 0 && doc.content.length > 0) {
      chunks.push(this.createFullDocChunk(doc, order++));
    }

    return chunks;
  }

  /**
   * Create title/intro chunk
   */
  private createTitleChunk(doc: DocumentPage, order: number): DocumentChunk {
    // Get first paragraph or first N characters as intro
    const intro = doc.content.substring(0, this.options.maxChunkSize);

    return {
      id: `${this.hashString(doc.url)}-title`,
      documentUrl: doc.url,
      title: doc.title,
      category: doc.category,
      loader: doc.loader,
      chunkType: 'title',
      content: `${doc.title}\n\n${intro}`,
      order,
      metadata: {
        hasCode: false,
        wordCount: this.countWords(intro),
        difficulty: doc.metadata.difficulty,
        tags: doc.metadata.tags,
      },
    };
  }

  /**
   * Create full document chunk for small docs
   */
  private createFullDocChunk(doc: DocumentPage, order: number): DocumentChunk {
    return {
      id: `${this.hashString(doc.url)}-full`,
      documentUrl: doc.url,
      title: doc.title,
      category: doc.category,
      loader: doc.loader,
      chunkType: 'full',
      content: doc.content,
      order,
      metadata: {
        hasCode: false,
        wordCount: this.countWords(doc.content),
        difficulty: doc.metadata.difficulty,
        tags: doc.metadata.tags,
      },
    };
  }

  /**
   * Chunk a section intelligently
   */
  private chunkSection(
    doc: DocumentPage,
    section: DocumentSection,
    startOrder: number
  ): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    let order = startOrder;

    // Create code block chunks first (if preserving)
    if (this.options.preserveCodeBlocks && section.codeBlocks.length > 0) {
      for (const codeBlock of section.codeBlocks) {
        chunks.push({
          id: `${this.hashString(doc.url)}-${order}`,
          documentUrl: doc.url,
          title: doc.title,
          category: doc.category,
          loader: doc.loader,
          chunkType: 'code',
          content: `${section.heading}\n\n${codeBlock.caption || ''}\n\n${codeBlock.code}`,
          codeLanguage: codeBlock.language,
          sectionHeading: section.heading,
          sectionLevel: section.level,
          order: order++,
          metadata: {
            hasCode: true,
            wordCount: this.countWords(codeBlock.code),
            difficulty: doc.metadata.difficulty,
            tags: doc.metadata.tags,
          },
        });
      }
    }

    // Create section text chunks
    if (section.content.trim().length >= this.options.minChunkSize) {
      const textChunks = this.splitText(section.content);

      for (const textChunk of textChunks) {
        chunks.push({
          id: `${this.hashString(doc.url)}-${order}`,
          documentUrl: doc.url,
          title: doc.title,
          category: doc.category,
          loader: doc.loader,
          chunkType: 'section',
          content: `${section.heading}\n\n${textChunk}`,
          sectionHeading: section.heading,
          sectionLevel: section.level,
          order: order++,
          metadata: {
            hasCode: section.codeBlocks.length > 0,
            wordCount: this.countWords(textChunk),
            difficulty: doc.metadata.difficulty,
            tags: doc.metadata.tags,
          },
        });
      }
    }

    return chunks;
  }

  /**
   * Split long text into overlapping chunks
   */
  private splitText(text: string): string[] {
    if (text.length <= this.options.maxChunkSize) {
      return [text];
    }

    const chunks: string[] = [];
    let start = 0;

    while (start < text.length) {
      let end = Math.min(start + this.options.maxChunkSize, text.length);

      // Try to break at sentence boundary
      if (end < text.length) {
        const sentenceEnd = text.lastIndexOf('.', end);
        const newlineEnd = text.lastIndexOf('\n', end);
        const breakPoint = Math.max(sentenceEnd, newlineEnd);

        if (breakPoint > start + this.options.minChunkSize) {
          end = breakPoint + 1;
        }
      }

      const chunk = text.substring(start, end).trim();
      if (chunk.length > 0) {
        chunks.push(chunk);
      }

      // Move start forward with overlap, ensuring it doesn't go backwards
      const prevStart = start;
      start = end - this.options.overlapSize;
      // Ensure we always make forward progress
      if (start <= prevStart) {
        start = Math.min(prevStart + 1, text.length);
      }
      if (start >= text.length) break;
    }

    return chunks;
  }

  /**
   * Count words in text
   */
  private countWords(text: string): number {
    return text.trim().split(/\s+/).length;
  }

  /**
   * Simple hash function for IDs
   */
  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }
}
