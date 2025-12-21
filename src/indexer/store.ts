/**
 * Enhanced SQLite storage layer with versioning and incremental updates
 */

import Database from 'better-sqlite3';
import type { DocumentPage, IndexStats } from './types.js';
import type { DocumentChunk } from './chunker.js';

const SCHEMA_VERSION = 1;

export interface ChunkResult {
  id: string;
  content: string;
  chunk_type: string;
  section_heading: string | null;
  section_level: number | null;
  code_language: string | null;
  has_code: number;
  document_id: number;
  url: string;
  title: string;
  category: string;
  loader: string;
  minecraft_version: string | null;
}

export class DocumentStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.initializeSchema();
  }

  /**
   * Initialize database schema with all tables
   */
  private initializeSchema() {
    this.db.exec(`
      -- Metadata table for versioning
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      -- Documents table
      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        raw_html TEXT,
        category TEXT NOT NULL,
        loader TEXT NOT NULL,
        minecraft_version TEXT,
        hash TEXT NOT NULL,
        indexed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- Sections table for structured content
      CREATE TABLE IF NOT EXISTS sections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id INTEGER NOT NULL,
        heading TEXT NOT NULL,
        level INTEGER NOT NULL,
        content TEXT NOT NULL,
        order_num INTEGER NOT NULL,
        FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
      );

      -- Code blocks table
      CREATE TABLE IF NOT EXISTS code_blocks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        section_id INTEGER NOT NULL,
        language TEXT NOT NULL,
        code TEXT NOT NULL,
        caption TEXT,
        FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE CASCADE
      );

      -- Chunks table for optimized search
      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        document_id INTEGER NOT NULL,
        chunk_type TEXT NOT NULL,
        content TEXT NOT NULL,
        section_heading TEXT,
        section_level INTEGER,
        code_language TEXT,
        order_num INTEGER NOT NULL,
        word_count INTEGER NOT NULL,
        has_code BOOLEAN NOT NULL,
        FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
      );

      -- Embeddings table for semantic search
      CREATE TABLE IF NOT EXISTS embeddings (
        chunk_id TEXT PRIMARY KEY,
        embedding BLOB NOT NULL,
        dimension INTEGER NOT NULL,
        model TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
      );

      -- Full-text search indexes
      CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
        title,
        content,
        category,
        content='documents',
        content_rowid='id'
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        content,
        section_heading,
        content='chunks',
        content_rowid='rowid'
      );

      -- Indexes for performance
      CREATE INDEX IF NOT EXISTS idx_documents_loader ON documents(loader);
      CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(category);
      CREATE INDEX IF NOT EXISTS idx_documents_hash ON documents(hash);
      CREATE INDEX IF NOT EXISTS idx_documents_version ON documents(minecraft_version);
      CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id);
      CREATE INDEX IF NOT EXISTS idx_chunks_type ON chunks(chunk_type);
      CREATE INDEX IF NOT EXISTS idx_embeddings_model ON embeddings(model);

      -- Triggers for FTS sync
      CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents BEGIN
        INSERT INTO documents_fts(rowid, title, content, category)
        VALUES (new.id, new.title, new.content, new.category);
      END;

      CREATE TRIGGER IF NOT EXISTS documents_ad AFTER DELETE ON documents BEGIN
        DELETE FROM documents_fts WHERE rowid = old.id;
      END;

      CREATE TRIGGER IF NOT EXISTS documents_au AFTER UPDATE ON documents BEGIN
        UPDATE documents_fts SET
          title = new.title,
          content = new.content,
          category = new.category
        WHERE rowid = new.id;
      END;

      CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
        INSERT INTO chunks_fts(rowid, content, section_heading)
        VALUES (new.rowid, new.content, new.section_heading);
      END;

      CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
        DELETE FROM chunks_fts WHERE rowid = old.rowid;
      END;
    `);

    // Initialize metadata
    this.initializeMetadata();
  }

  /**
   * Initialize metadata table
   */
  private initializeMetadata() {
    const stmt = this.db.prepare('INSERT OR IGNORE INTO metadata (key, value) VALUES (?, ?)');
    stmt.run('schema_version', SCHEMA_VERSION.toString());
    stmt.run('index_version', '0.1.0');
    stmt.run('last_updated', new Date().toISOString());
  }

  /**
   * Check if document needs updating
   */
  needsUpdate(url: string, hash: string): boolean {
    const stmt = this.db.prepare('SELECT hash FROM documents WHERE url = ?');
    const result = stmt.get(url) as { hash: string } | undefined;

    // Needs update if doesn't exist or hash changed
    return !result || result.hash !== hash;
  }

  /**
   * Store a complete document with sections
   */
  storeDocument(doc: DocumentPage): number {
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO documents (url, title, content, raw_html, category, loader, hash, minecraft_version, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);

    const result = insert.run(
      doc.url,
      doc.title,
      doc.content,
      doc.rawHtml,
      doc.category,
      doc.loader,
      doc.hash,
      doc.minecraftVersion || null
    );

    const documentId = result.lastInsertRowid as number;

    // Delete old sections/code blocks (CASCADE will handle this)
    this.db.prepare('DELETE FROM sections WHERE document_id = ?').run(documentId);

    // Store sections and code blocks
    for (const section of doc.sections) {
      this.storeSection(documentId, section);
    }

    return documentId;
  }

  /**
   * Store a section with its code blocks
   */
  private storeSection(
    documentId: number,
    section: {
      heading: string;
      level: number;
      content: string;
      order: number;
      codeBlocks: Array<{ language: string; code: string; caption?: string }>;
    }
  ): number {
    const insert = this.db.prepare(`
      INSERT INTO sections (document_id, heading, level, content, order_num)
      VALUES (?, ?, ?, ?, ?)
    `);

    const result = insert.run(
      documentId,
      section.heading,
      section.level,
      section.content,
      section.order
    );

    const sectionId = result.lastInsertRowid as number;

    // Store code blocks
    const codeInsert = this.db.prepare(`
      INSERT INTO code_blocks (section_id, language, code, caption)
      VALUES (?, ?, ?, ?)
    `);

    for (const block of section.codeBlocks) {
      codeInsert.run(sectionId, block.language, block.code, block.caption || null);
    }

    return sectionId;
  }

  /**
   * Store document chunks for optimized search
   */
  storeChunks(chunks: DocumentChunk[], documentId: number) {
    // Delete old chunks for this document
    this.db.prepare('DELETE FROM chunks WHERE document_id = ?').run(documentId);

    const insert = this.db.prepare(`
      INSERT INTO chunks (
        id, document_id, chunk_type, content, section_heading, section_level,
        code_language, order_num, word_count, has_code
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const chunk of chunks) {
      insert.run(
        chunk.id,
        documentId,
        chunk.chunkType,
        chunk.content,
        chunk.sectionHeading || null,
        chunk.sectionLevel || null,
        chunk.codeLanguage || null,
        chunk.order,
        chunk.metadata.wordCount,
        chunk.metadata.hasCode ? 1 : 0
      );
    }
  }

  /**
   * Search using chunks (more precise results)
   */
  searchChunks(query: string, category?: string, loader?: string, limit: number = 10) {
    let sql = `
      SELECT
        c.id,
        c.content,
        c.chunk_type,
        c.section_heading,
        c.code_language,
        d.url,
        d.title,
        d.category,
        d.loader,
        chunks_fts.rank
      FROM chunks_fts
      JOIN chunks c ON chunks_fts.rowid = c.rowid
      JOIN documents d ON c.document_id = d.id
      WHERE chunks_fts MATCH ?
    `;

    const params: (string | number)[] = [query];

    if (category && category !== 'all') {
      sql += ' AND d.category = ?';
      params.push(category);
    }

    if (loader) {
      sql += ' AND d.loader = ?';
      params.push(loader);
    }

    sql += ` ORDER BY chunks_fts.rank LIMIT ?`;
    params.push(limit);

    const stmt = this.db.prepare(sql);
    return stmt.all(...params);
  }

  /**
   * Search documents (broader results)
   */
  searchDocuments(query: string, category?: string, loader?: string, limit: number = 10) {
    let sql = `
      SELECT
        d.id,
        d.url,
        d.title,
        d.content,
        d.category,
        d.loader,
        documents_fts.rank
      FROM documents_fts
      JOIN documents d ON documents_fts.rowid = d.id
      WHERE documents_fts MATCH ?
    `;

    const params: (string | number)[] = [query];

    if (category && category !== 'all') {
      sql += ' AND d.category = ?';
      params.push(category);
    }

    if (loader) {
      sql += ' AND d.loader = ?';
      params.push(loader);
    }

    sql += ` ORDER BY documents_fts.rank LIMIT ?`;
    params.push(limit);

    const stmt = this.db.prepare(sql);
    return stmt.all(...params);
  }

  /**
   * Get index statistics
   */
  getStats(): IndexStats {
    const docCount = this.db.prepare('SELECT COUNT(*) as count FROM documents').get() as {
      count: number;
    };

    const sectionCount = this.db.prepare('SELECT COUNT(*) as count FROM sections').get() as {
      count: number;
    };

    const codeCount = this.db.prepare('SELECT COUNT(*) as count FROM code_blocks').get() as {
      count: number;
    };

    const loaderCounts = this.db
      .prepare('SELECT loader, COUNT(*) as count FROM documents GROUP BY loader')
      .all() as Array<{ loader: string; count: number }>;

    const lastUpdated = this.db
      .prepare("SELECT value FROM metadata WHERE key = 'last_updated'")
      .get() as { value: string };

    const version = this.db
      .prepare("SELECT value FROM metadata WHERE key = 'index_version'")
      .get() as { value: string };

    const loaders = {
      fabric: 0,
      neoforge: 0,
      shared: 0,
    };

    for (const item of loaderCounts) {
      if (item.loader in loaders) {
        loaders[item.loader as keyof typeof loaders] = item.count;
      }
    }

    return {
      totalDocuments: docCount.count,
      totalSections: sectionCount.count,
      totalCodeBlocks: codeCount.count,
      lastUpdated: new Date(lastUpdated.value),
      version: version.value,
      loaders,
    };
  }

  /**
   * Update last updated timestamp
   */
  updateTimestamp() {
    this.db
      .prepare("UPDATE metadata SET value = ? WHERE key = 'last_updated'")
      .run(new Date().toISOString());
  }

  /**
   * Get all document URLs (for update checking)
   */
  getAllUrls(): string[] {
    const results = this.db.prepare('SELECT url FROM documents').all() as Array<{ url: string }>;
    return results.map((r) => r.url);
  }

  /**
   * Store embeddings for chunks
   */
  storeEmbeddings(embeddings: Array<{ chunkId: string; embedding: number[] }>, model: string) {
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO embeddings (chunk_id, embedding, dimension, model)
      VALUES (?, ?, ?, ?)
    `);

    for (const item of embeddings) {
      // Convert number array to Buffer (BLOB)
      const buffer = Buffer.from(new Float32Array(item.embedding).buffer);
      insert.run(item.chunkId, buffer, item.embedding.length, model);
    }
  }

  /**
   * Get embedding for a chunk
   */
  getEmbedding(chunkId: string): number[] | undefined {
    const stmt = this.db.prepare('SELECT embedding, dimension FROM embeddings WHERE chunk_id = ?');
    const result = stmt.get(chunkId) as { embedding: Buffer; dimension: number } | undefined;

    if (!result) return undefined;

    // Convert Buffer back to number array
    const float32Array = new Float32Array(
      result.embedding.buffer,
      result.embedding.byteOffset,
      result.embedding.byteLength / Float32Array.BYTES_PER_ELEMENT
    );

    return Array.from(float32Array);
  }

  /**
   * Get all embeddings (for semantic search)
   */
  getAllEmbeddings(): Array<{ chunkId: string; embedding: number[] }> {
    const stmt = this.db.prepare('SELECT chunk_id, embedding, dimension FROM embeddings');
    const results = stmt.all() as Array<{
      chunk_id: string;
      embedding: Buffer;
      dimension: number;
    }>;

    return results.map((row) => {
      const float32Array = new Float32Array(
        row.embedding.buffer,
        row.embedding.byteOffset,
        row.embedding.byteLength / Float32Array.BYTES_PER_ELEMENT
      );

      return {
        chunkId: row.chunk_id,
        embedding: Array.from(float32Array),
      };
    });
  }

  /**
   * Get embeddings in batches for efficient memory usage
   * Returns embeddings in chunks to avoid loading all at once
   */
  getEmbeddingsBatch(
    batchSize: number = 500,
    offset: number = 0
  ): Array<{ chunkId: string; embedding: number[] }> {
    const stmt = this.db.prepare(
      'SELECT chunk_id, embedding, dimension FROM embeddings LIMIT ? OFFSET ?'
    );
    const results = stmt.all(batchSize, offset) as Array<{
      chunk_id: string;
      embedding: Buffer;
      dimension: number;
    }>;

    return results.map((row) => {
      const float32Array = new Float32Array(
        row.embedding.buffer,
        row.embedding.byteOffset,
        row.embedding.byteLength / Float32Array.BYTES_PER_ELEMENT
      );

      return {
        chunkId: row.chunk_id,
        embedding: Array.from(float32Array),
      };
    });
  }

  /**
   * Get total embedding count
   */
  getEmbeddingCount(): number {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM embeddings');
    const result = stmt.get() as { count: number };
    return result.count;
  }

  /**
   * Delete embeddings for a document
   */
  deleteEmbeddings(documentId: number) {
    this.db
      .prepare(
        `
      DELETE FROM embeddings
      WHERE chunk_id IN (
        SELECT id FROM chunks WHERE document_id = ?
      )
    `
      )
      .run(documentId);
  }

  /**
   * Get documents by Minecraft version
   */
  getDocumentsByVersion(version: string) {
    const stmt = this.db.prepare(`
      SELECT * FROM documents WHERE minecraft_version = ?
    `);
    return stmt.all(version);
  }

  /**
   * Get all unique Minecraft versions
   */
  getAllVersions(): string[] {
    const stmt = this.db.prepare(`
      SELECT DISTINCT minecraft_version FROM documents
      WHERE minecraft_version IS NOT NULL
      ORDER BY minecraft_version DESC
    `);
    const results = stmt.all() as Array<{ minecraft_version: string }>;
    return results.map((r) => r.minecraft_version);
  }

  /**
   * Search with version filter
   */
  searchByVersion(
    query: string,
    version: string,
    category?: string,
    loader?: string,
    limit: number = 10
  ) {
    let sql = `
      SELECT
        c.id,
        c.content,
        c.chunk_type,
        c.section_heading,
        c.code_language,
        d.url,
        d.title,
        d.category,
        d.loader,
        d.minecraft_version,
        chunks_fts.rank
      FROM chunks_fts
      JOIN chunks c ON chunks_fts.rowid = c.rowid
      JOIN documents d ON c.document_id = d.id
      WHERE chunks_fts MATCH ? AND (d.minecraft_version = ? OR d.minecraft_version LIKE ?)
    `;

    const params: (string | number)[] = [query, version, `${version}.%`];

    if (category && category !== 'all') {
      sql += ' AND d.category = ?';
      params.push(category);
    }

    if (loader) {
      sql += ' AND d.loader = ?';
      params.push(loader);
    }

    sql += ` ORDER BY chunks_fts.rank LIMIT ?`;
    params.push(limit);

    const stmt = this.db.prepare(sql);
    return stmt.all(...params);
  }

  /**
   * Get embedding statistics
   */
  getEmbeddingStats(): {
    totalEmbeddings: number;
    models: Array<{ model: string; count: number }>;
  } {
    const total = this.db.prepare('SELECT COUNT(*) as count FROM embeddings').get() as {
      count: number;
    };

    const models = this.db
      .prepare('SELECT model, COUNT(*) as count FROM embeddings GROUP BY model')
      .all() as Array<{ model: string; count: number }>;

    return {
      totalEmbeddings: total.count,
      models,
    };
  }

  /**
   * Search for code examples by topic
   * Optimized for finding relevant code blocks with context
   */
  searchCodeExamples(
    topic: string,
    options: {
      language?: string;
      minecraftVersion?: string;
      loader?: string;
      category?: string;
      limit?: number;
    } = {}
  ) {
    const { language, minecraftVersion, loader, category, limit = 10 } = options;

    // Build FTS query with topic keywords
    const searchQuery = topic.trim();

    let sql = `
      SELECT
        c.id,
        c.content,
        c.chunk_type,
        c.section_heading,
        c.section_level,
        c.code_language,
        c.has_code,
        d.id as document_id,
        d.url,
        d.title,
        d.category,
        d.loader,
        d.minecraft_version,
        chunks_fts.rank
      FROM chunks_fts
      JOIN chunks c ON chunks_fts.rowid = c.rowid
      JOIN documents d ON c.document_id = d.id
      WHERE chunks_fts MATCH ?
        AND c.has_code = 1
    `;

    const params: (string | number)[] = [searchQuery];

    if (language) {
      sql += ' AND c.code_language = ?';
      params.push(language);
    }

    if (minecraftVersion) {
      // Prefix match for version (e.g. "1.21" matches "1.21.4")
      sql += ' AND (d.minecraft_version = ? OR d.minecraft_version LIKE ?)';
      params.push(minecraftVersion, `${minecraftVersion}.%`);
    }

    if (loader) {
      sql += ' AND d.loader = ?';
      params.push(loader);
    }

    if (category && category !== 'all') {
      sql += ' AND d.category = ?';
      params.push(category);
    }

    sql += ` ORDER BY chunks_fts.rank LIMIT ?`;
    params.push(limit);

    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as Array<{
      id: string;
      content: string;
      chunk_type: string;
      section_heading: string | null;
      section_level: number | null;
      code_language: string;
      has_code: number;
      document_id: number;
      url: string;
      title: string;
      category: string;
      loader: string;
      minecraft_version: string | null;
      rank: number;
    }>;
  }

  /**
   * Get code blocks from a document's sections
   * Returns all code blocks with their section context
   */
  getCodeBlocksWithContext(documentId: number) {
    const sql = `
      SELECT
        cb.id,
        cb.language,
        cb.code,
        cb.caption,
        s.heading as section_heading,
        s.level as section_level,
        s.content as section_content,
        d.id as document_id,
        d.title as document_title,
        d.url as document_url,
        d.category,
        d.loader,
        d.minecraft_version
      FROM code_blocks cb
      JOIN sections s ON cb.section_id = s.id
      JOIN documents d ON s.document_id = d.id
      WHERE d.id = ?
      ORDER BY s.order_num, cb.id
    `;

    const stmt = this.db.prepare(sql);
    return stmt.all(documentId) as Array<{
      id: number;
      language: string;
      code: string;
      caption: string | null;
      section_heading: string;
      section_level: number;
      section_content: string;
      document_id: number;
      document_title: string;
      document_url: string;
      category: string;
      loader: string;
      minecraft_version: string | null;
    }>;
  }

  /**
   * Get code blocks by language across all documents
   */
  getCodeBlocksByLanguage(
    language: string,
    options: {
      loader?: string;
      minecraftVersion?: string;
      limit?: number;
    } = {}
  ) {
    const { loader, minecraftVersion, limit = 20 } = options;

    let sql = `
      SELECT
        cb.id,
        cb.language,
        cb.code,
        cb.caption,
        s.heading as section_heading,
        s.level as section_level,
        s.content as section_content,
        d.id as document_id,
        d.title as document_title,
        d.url as document_url,
        d.category,
        d.loader,
        d.minecraft_version
      FROM code_blocks cb
      JOIN sections s ON cb.section_id = s.id
      JOIN documents d ON s.document_id = d.id
      WHERE cb.language = ?
    `;

    const params: (string | number)[] = [language];

    if (loader) {
      sql += ' AND d.loader = ?';
      params.push(loader);
    }

    if (minecraftVersion) {
      // Prefix match for version (e.g. "1.21" matches "1.21.4")
      sql += ' AND (d.minecraft_version = ? OR d.minecraft_version LIKE ?)';
      params.push(minecraftVersion, `${minecraftVersion}.%`);
    }

    sql += ' ORDER BY d.id, s.order_num LIMIT ?';
    params.push(limit);

    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as Array<{
      id: number;
      language: string;
      code: string;
      caption: string | null;
      section_heading: string;
      section_level: number;
      section_content: string;
      document_id: number;
      document_title: string;
      document_url: string;
      category: string;
      loader: string;
      minecraft_version: string | null;
    }>;
  }

  /**
   * Search sections by topic (useful for finding context)
   */
  searchSections(
    query: string,
    options: {
      loader?: string;
      minecraftVersion?: string;
      category?: string;
      limit?: number;
    } = {}
  ) {
    const { loader, minecraftVersion, category, limit = 10 } = options;

    let sql = `
      SELECT
        s.id,
        s.heading,
        s.level,
        s.content,
        s.order_num,
        d.id as document_id,
        d.title as document_title,
        d.url as document_url,
        d.category,
        d.loader,
        d.minecraft_version
      FROM sections s
      JOIN documents d ON s.document_id = d.id
      WHERE s.heading LIKE ? OR s.content LIKE ?
    `;

    const searchPattern = `%${query}%`;
    const params: (string | number)[] = [searchPattern, searchPattern];

    if (loader) {
      sql += ' AND d.loader = ?';
      params.push(loader);
    }

    if (minecraftVersion) {
      // Prefix match for version (e.g. "1.21" matches "1.21.4")
      sql += ' AND (d.minecraft_version = ? OR d.minecraft_version LIKE ?)';
      params.push(minecraftVersion, `${minecraftVersion}.%`);
    }

    if (category && category !== 'all') {
      sql += ' AND d.category = ?';
      params.push(category);
    }

    sql += ' ORDER BY s.order_num LIMIT ?';
    params.push(limit);

    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as Array<{
      id: number;
      heading: string;
      level: number;
      content: string;
      order_num: number;
      document_id: number;
      document_title: string;
      document_url: string;
      category: string;
      loader: string;
      minecraft_version: string | null;
    }>;
  }

  /**
   * Get available code languages in the database
   */
  getAvailableLanguages(): Array<{ language: string; count: number }> {
    const sql = `
      SELECT code_language as language, COUNT(*) as count
      FROM chunks
      WHERE has_code = 1 AND code_language IS NOT NULL
      GROUP BY code_language
      ORDER BY count DESC
    `;

    const stmt = this.db.prepare(sql);
    return stmt.all() as Array<{ language: string; count: number }>;
  }

  /**
   * Find similar chunks using vector similarity
   * Note: This performs a full scan of embeddings in memory.
   * For large datasets, this should be optimized or moved to a vector DB.
   */
  findSimilarChunks(
    embedding: number[],
    options: {
      limit?: number;
      loader?: string;
      minecraftVersion?: string; // Exact match or prefix
      category?: string;
    } = {}
  ) {
    const { limit = 10, loader, minecraftVersion, category } = options;

    // 1. Fetch candidate embeddings + metadata
    // We join with chunks and documents to apply filters early
    let sql = `
      SELECT
        e.chunk_id,
        e.embedding,
        c.content,
        c.chunk_type,
        c.section_heading,
        c.section_level,
        c.code_language,
        c.has_code,
        d.id as document_id,
        d.url,
        d.title,
        d.category,
        d.loader,
        d.minecraft_version
      FROM embeddings e
      JOIN chunks c ON e.chunk_id = c.id
      JOIN documents d ON c.document_id = d.id
      WHERE 1=1
    `;

    const params: (string | number)[] = [];

    if (loader) {
      sql += ' AND d.loader = ?';
      params.push(loader);
    }

    if (category && category !== 'all') {
      sql += ' AND d.category = ?';
      params.push(category);
    }

    // For version, we might want to handle it in the service layer or here.
    // If passed here, we assume it's a filter.
    // Support exact match OR prefix match (e.g. "1.21" matches "1.21.4")
    if (minecraftVersion) {
      sql += ' AND (d.minecraft_version = ? OR d.minecraft_version LIKE ?)';
      params.push(minecraftVersion, `${minecraftVersion}.%`);
    }

    const stmt = this.db.prepare(sql);

    const candidates = stmt.all(...params) as Array<
      ChunkResult & { chunk_id: string; embedding: Buffer }
    >;

    // 2. Compute cosine similarity
    const results = candidates.map((candidate) => {
      // Convert Buffer to Float32Array
      // Assuming embedding is stored as a buffer of floats (4 bytes each)
      const vector = new Float32Array(
        candidate.embedding.buffer,
        candidate.embedding.byteOffset,
        candidate.embedding.byteLength / 4
      );

      const similarity = this.cosineSimilarity(embedding, vector);
      return { ...candidate, similarity };
    });

    // 3. Sort and limit
    return results.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
  }

  private cosineSimilarity(a: number[] | Float32Array, b: number[] | Float32Array): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      dotProduct += a[i]! * b[i]!;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      normA += a[i]! * a[i]!;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      normB += b[i]! * b[i]!;
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Advanced FTS search with fallback
   * Tries FTS5 first, falls back to LIKE if no results
   */
  searchChunksAdvanced(
    ftsQuery: string,
    likePatterns: string[],
    options: {
      hasCode?: boolean;
      language?: string;
      loader?: string;
      minecraftVersion?: string;
      category?: string;
      limit?: number;
    } = {}
  ) {
    const { hasCode = true, language, loader, minecraftVersion, category, limit = 30 } = options;

    type ChunkResult = {
      id: string;
      content: string;
      chunk_type: string;
      section_heading: string | null;
      section_level: number | null;
      code_language: string | null;
      has_code: number;
      document_id: number;
      url: string;
      title: string;
      category: string;
      loader: string;
      minecraft_version: string | null;
    };

    let results: ChunkResult[] = [];

    // Strategy 1: Try FTS5 search
    if (ftsQuery && ftsQuery.length > 0) {
      try {
        let sql = `
          SELECT
            c.id,
            c.content,
            c.chunk_type,
            c.section_heading,
            c.section_level,
            c.code_language,
            c.has_code,
            d.id as document_id,
            d.url,
            d.title,
            d.category,
            d.loader,
            d.minecraft_version
          FROM chunks_fts
          JOIN chunks c ON chunks_fts.rowid = c.rowid
          JOIN documents d ON c.document_id = d.id
          WHERE chunks_fts MATCH ?
        `;

        const params: (string | number)[] = [ftsQuery];

        if (hasCode) {
          sql += ' AND c.has_code = 1';
        }

        if (language) {
          sql += ' AND c.code_language = ?';
          params.push(language);
        }

        if (loader) {
          sql += ' AND d.loader = ?';
          params.push(loader);
        }

        if (minecraftVersion) {
          // Prefix match for version (e.g. "1.21" matches "1.21.4")
          sql += ' AND (d.minecraft_version = ? OR d.minecraft_version LIKE ?)';
          params.push(minecraftVersion, `${minecraftVersion}.%`);
        }

        if (category && category !== 'all') {
          sql += ' AND d.category = ?';
          params.push(category);
        }

        sql += ` ORDER BY rank LIMIT ?`;
        params.push(limit);

        const stmt = this.db.prepare(sql);
        results = stmt.all(...params) as ChunkResult[];
      } catch {
        // FTS query might fail with special characters, continue to fallback
        console.error('[store] FTS query failed, trying LIKE fallback');
      }
    }

    // Strategy 2: LIKE fallback if FTS returned no results
    if (results.length === 0 && likePatterns.length > 0) {
      const likeConditions = likePatterns
        .slice(0, 3) // Limit to 3 patterns for performance
        .map(() => '(c.content LIKE ? OR c.section_heading LIKE ?)')
        .join(' OR ');

      let sql = `
        SELECT
          c.id,
          c.content,
          c.chunk_type,
          c.section_heading,
          c.section_level,
          c.code_language,
          c.has_code,
          d.id as document_id,
          d.url,
          d.title,
          d.category,
          d.loader,
          d.minecraft_version
        FROM chunks c
        JOIN documents d ON c.document_id = d.id
        WHERE (${likeConditions})
      `;

      const params: (string | number)[] = [];
      for (const pattern of likePatterns.slice(0, 3)) {
        params.push(pattern, pattern);
      }

      if (hasCode) {
        sql += ' AND c.has_code = 1';
      }

      if (language) {
        sql += ' AND c.code_language = ?';
        params.push(language);
      }

      if (loader) {
        sql += ' AND d.loader = ?';
        params.push(loader);
      }
      if (minecraftVersion) {
        // Prefix match for version (e.g. "1.21" matches "1.21.4")
        sql += ' AND (d.minecraft_version = ? OR d.minecraft_version LIKE ?)';
        params.push(minecraftVersion, `${minecraftVersion}.%`);
      }

      if (category && category !== 'all') {
        sql += ' AND d.category = ?';
        params.push(category);
      }

      sql += ` LIMIT ?`;
      params.push(limit);

      const stmt = this.db.prepare(sql);
      results = stmt.all(...params) as ChunkResult[];
    }

    return results;
  }

  /**
   * Search documents by title and content with LIKE
   */
  searchDocumentsLike(
    patterns: string[],
    options: {
      loader?: string;
      minecraftVersion?: string;
      category?: string;
      limit?: number;
    } = {}
  ) {
    const { loader, minecraftVersion, category, limit = 20 } = options;

    if (patterns.length === 0) return [];

    const likeConditions = patterns
      .slice(0, 3)
      .map(() => '(d.title LIKE ? OR d.content LIKE ?)')
      .join(' OR ');

    let sql = `
      SELECT
        d.id,
        d.url,
        d.title,
        d.content,
        d.category,
        d.loader,
        d.minecraft_version
      FROM documents d
      WHERE (${likeConditions})
    `;

    const params: (string | number)[] = [];
    for (const pattern of patterns.slice(0, 3)) {
      params.push(pattern, pattern);
    }

    if (loader) {
      sql += ' AND d.loader = ?';
      params.push(loader);
    }
    if (minecraftVersion) {
      // Prefix match for version (e.g. "1.21" matches "1.21.4")
      sql += ' AND (d.minecraft_version = ? OR d.minecraft_version LIKE ?)';
      params.push(minecraftVersion, `${minecraftVersion}.%`);
    }

    if (category && category !== 'all') {
      sql += ' AND d.category = ?';
      params.push(category);
    }

    sql += ` LIMIT ?`;
    params.push(limit);

    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as Array<{
      id: number;
      url: string;
      title: string;
      content: string;
      category: string;
      loader: string;
      minecraft_version: string | null;
    }>;
  }

  /**
   * Search code blocks by code content patterns
   */
  searchCodeBlocksByPatterns(
    codePatterns: string[],
    options: {
      language?: string;
      loader?: string;
      minecraftVersion?: string;
      limit?: number;
    } = {}
  ) {
    const { language, loader, minecraftVersion, limit = 20 } = options;

    if (codePatterns.length === 0) return [];

    const likeConditions = codePatterns
      .slice(0, 5)
      .map(() => 'cb.code LIKE ?')
      .join(' OR ');

    let sql = `
      SELECT
        cb.id,
        cb.language,
        cb.code,
        cb.caption,
        s.heading as section_heading,
        s.level as section_level,
        s.content as section_content,
        d.id as document_id,
        d.title as document_title,
        d.url as document_url,
        d.category,
        d.loader,
        d.minecraft_version
      FROM code_blocks cb
      JOIN sections s ON cb.section_id = s.id
      JOIN documents d ON s.document_id = d.id
      WHERE (${likeConditions})
    `;

    const params: (string | number)[] = codePatterns.slice(0, 5).map((p) => `%${p}%`);

    if (language) {
      sql += ' AND cb.language = ?';
      params.push(language);
    }

    if (loader) {
      sql += ' AND d.loader = ?';
      params.push(loader);
    }

    if (minecraftVersion) {
      // Prefix match for version (e.g. "1.21" matches "1.21.4")
      sql += ' AND (d.minecraft_version = ? OR d.minecraft_version LIKE ?)';
      params.push(minecraftVersion, `${minecraftVersion}.%`);
    }

    sql += ` ORDER BY d.id, s.order_num LIMIT ?`;
    params.push(limit);

    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as Array<{
      id: number;
      language: string;
      code: string;
      caption: string | null;
      section_heading: string;
      section_level: number;
      section_content: string;
      document_id: number;
      document_title: string;
      document_url: string;
      category: string;
      loader: string;
      minecraft_version: string | null;
    }>;
  }

  /**
   * Get all code blocks with full context (for client-side filtering)
   */
  getAllCodeBlocksWithContext(
    options: {
      language?: string;
      loader?: string;
      minecraftVersion?: string;
      limit?: number;
    } = {}
  ) {
    const { language, loader, minecraftVersion, limit = 100 } = options;

    let sql = `
      SELECT
        cb.id,
        cb.language,
        cb.code,
        cb.caption,
        s.heading as section_heading,
        s.level as section_level,
        s.content as section_content,
        d.id as document_id,
        d.title as document_title,
        d.url as document_url,
        d.category,
        d.loader,
        d.minecraft_version
      FROM code_blocks cb
      JOIN sections s ON cb.section_id = s.id
      JOIN documents d ON s.document_id = d.id
      WHERE 1=1
    `;

    const params: (string | number)[] = [];

    if (language) {
      sql += ' AND cb.language = ?';
      params.push(language);
    }

    if (loader) {
      sql += ' AND d.loader = ?';
      params.push(loader);
    }

    if (minecraftVersion) {
      // Prefix match for version (e.g. "1.21" matches "1.21.4")
      sql += ' AND (d.minecraft_version = ? OR d.minecraft_version LIKE ?)';
      params.push(minecraftVersion, `${minecraftVersion}.%`);
    }

    sql += ` ORDER BY d.id, s.order_num LIMIT ?`;
    params.push(limit);

    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as Array<{
      id: number;
      language: string;
      code: string;
      caption: string | null;
      section_heading: string;
      section_level: number;
      section_content: string;
      document_id: number;
      document_title: string;
      document_url: string;
      category: string;
      loader: string;
      minecraft_version: string | null;
    }>;
  }

  /**
   * Get all code blocks for a specific document
   */
  getCodeBlocksForDocument(documentId: number) {
    const sql = `
      SELECT
        cb.id,
        cb.language,
        cb.code,
        cb.caption,
        s.heading as section_heading,
        s.level as section_level,
        s.content as section_content,
        d.id as document_id,
        d.title as document_title,
        d.url as document_url,
        d.category,
        d.loader,
        d.minecraft_version
      FROM code_blocks cb
      JOIN sections s ON cb.section_id = s.id
      JOIN documents d ON s.document_id = d.id
      WHERE d.id = ?
    `;
    const stmt = this.db.prepare(sql);
    return stmt.all(documentId) as Array<{
      id: number;
      language: string;
      code: string;
      caption: string | null;
      section_heading: string;
      section_level: number;
      section_content: string;
      document_id: number;
      document_title: string;
      document_url: string;
      category: string;
      loader: string;
      minecraft_version: string | null;
    }>;
  }

  /**
   * Close the database
   */
  close() {
    this.db.close();
  }
}
