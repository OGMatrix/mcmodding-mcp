# mcmodding-mcp

[![npm version](https://img.shields.io/npm/v/mcmodding-mcp.svg)](https://www.npmjs.com/package/mcmodding-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/OGMatrix/mcmodding-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/OGMatrix/mcmodding-mcp/actions/workflows/ci.yml)

> MCP server providing AI assistants with comprehensive, up-to-date Minecraft modding documentation for Fabric and NeoForge.

## What is this?

**mcmodding-mcp** is a [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that gives AI assistants like Claude direct access to Minecraft modding documentation. Instead of relying on potentially outdated training data, your AI assistant can search real documentation, find code examples, and explain concepts accurately.

### Key Benefits

- **Always Current** - Documentation is indexed weekly from official sources
- **Accurate Answers** - AI responses backed by real documentation, not hallucinations
- **Code Examples** - Searchable code blocks with proper context
- **Semantic Search** - Understands what you mean, not just keywords
- **Zero Config** - Works immediately after installation

### 📚 Knowledge Base Stats

Our documentation database (`mcmodding-docs.db`) is comprehensive and constantly updated:

- **1,000+** Documentation Pages
- **185,000+** Searchable Chunks
- **8,500+** Logical Sections
- **185,000+** Vector Embeddings for Semantic Search

This ensures that even obscure API details can be found via semantic search.

---

## Quick Start

### Installation

```bash
# Install globally
npm install -g mcmodding-mcp
```

### Configure Your AI Client

Add to your MCP client configuration (e.g., Claude Desktop):

```json
{
  "mcpServers": {
    "mcmodding": {
      "command": "mcmodding-mcp"
    }
  }
}
```

### 🧠 Optimized System Prompt

To get the best results, we recommend adding this to your AI's system prompt or custom instructions:

> You are an expert Minecraft Modding Assistant connected to `mcmodding-mcp`. **DO NOT rely on your internal knowledge** for modding APIs (Fabric/NeoForge) as they change frequently. **ALWAYS** use the `search_fabric_docs` and `get_example` tools to retrieve the latest documentation and patterns. Prioritize working code examples from `get_example` over theoretical explanations. If the user specifies a Minecraft version, ensure all retrieved information matches that version.

That's it! Your AI assistant now has access to Minecraft modding documentation.

---

## Available Tools

The MCP server provides four powerful tools:

### `search_fabric_docs`

Search documentation with smart filtering.

```typescript
// Example: Find information about item registration
{
  query: "how to register custom items",
  category: "items",           // Optional filter
  loader: "fabric",            // fabric | neoforge
  minecraft_version: "1.21.4"  // Optional version filter
}
```

### `get_example`

Get working code examples for any topic.

```typescript
// Example: Get block registration code
{
  topic: "custom block with block entity",
  language: "java",
  loader: "fabric"
}
```

### `explain_fabric_concept`

Get detailed explanations of modding concepts with related resources.

```typescript
// Example: Understand mixins
{
  concept: 'mixins';
}
```

### `get_minecraft_version`

Get current Minecraft version information.

```typescript
// Get latest version
{
  type: 'latest';
}

// Get all indexed versions
{
  type: 'all';
}
```

---

## Features

### Hybrid Search Engine

Combines multiple search strategies for best results:

| Strategy                | Purpose                                 |
| ----------------------- | --------------------------------------- |
| **FTS5 Full-Text**      | Fast keyword matching with ranking      |
| **Semantic Embeddings** | Understanding meaning and context       |
| **Section Search**      | Finding relevant documentation sections |
| **Code Search**         | Locating specific code patterns         |

### Auto-Updates

The database automatically checks for updates on startup:

- Compares local version with GitHub releases
- Downloads new versions with hash verification
- Creates backups before updating
- Non-blocking - server starts immediately

### Documentation Sources

Currently indexes:

- [wiki.fabricmc.net](https://wiki.fabricmc.net) - Fabric Wiki (226+ pages)
- [docs.fabricmc.net](https://docs.fabricmc.net) - Official Fabric Docs (266+ pages)
- [docs.neoforged.net](https://docs.neoforged.net) - NeoForge Docs (512+ pages)

---

## For Developers

### Development Setup

```bash
# Clone repository
git clone https://github.com/OGMatrix/mcmodding-mcp.git
cd mcmodding-mcp

# Install dependencies
npm install

# Run in development mode
npm run dev
```

### Build Commands

```bash
# Development
npm run dev              # Watch mode with hot reload
npm run typecheck        # TypeScript type checking
npm run lint             # ESLint
npm run test             # Run tests
npm run format           # Prettier formatting

# Production
npm run build            # Build TypeScript
npm run build:prod       # Build with fresh documentation index
npm run index-docs       # Index documentation with embeddings
```

### Project Structure

```
mcmodding-mcp/
├── src/
│   ├── index.ts              # MCP server entry point
│   ├── db-versioning.ts      # Auto-update system
│   ├── indexer/
│   │   ├── crawler.ts        # Documentation crawler
│   │   ├── chunker.ts        # Text chunking
│   │   ├── embeddings.ts     # Semantic embeddings
│   │   ├── store.ts          # SQLite database
│   │   └── sitemap.ts        # Sitemap parsing
│   ├── services/
│   │   ├── search-service.ts # Search logic
│   │   └── concept-service.ts # Concept explanations
│   └── tools/
│       ├── searchDocs.ts     # search_fabric_docs handler
│       ├── getExample.ts     # get_example handler
│       └── explainConcept.ts # explain_fabric_concept handler
├── scripts/
│   └── index-docs.ts         # Documentation indexing script
├── data/
│   ├── mcmodding-docs.db     # SQLite database
│   └── db-manifest.json      # Version manifest
└── dist/                     # Compiled JavaScript
```

### Database Schema

```sql
-- Documents: Full documentation pages
CREATE TABLE documents (
  id INTEGER PRIMARY KEY,
  url TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT NOT NULL,
  loader TEXT NOT NULL,          -- fabric | neoforge | shared
  minecraft_version TEXT,
  hash TEXT NOT NULL             -- For change detection
);

-- Chunks: Searchable content units
CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  document_id INTEGER NOT NULL,
  chunk_type TEXT NOT NULL,      -- title | section | code | full
  content TEXT NOT NULL,
  section_heading TEXT,
  code_language TEXT,
  word_count INTEGER,
  has_code BOOLEAN
);

-- Embeddings: Semantic search vectors
CREATE TABLE embeddings (
  chunk_id TEXT PRIMARY KEY,
  embedding BLOB NOT NULL,       -- 384-dim Float32Array
  dimension INTEGER NOT NULL,
  model TEXT NOT NULL            -- Xenova/all-MiniLM-L6-v2
);

-- FTS5 indexes for fast text search
CREATE VIRTUAL TABLE documents_fts USING fts5(...);
CREATE VIRTUAL TABLE chunks_fts USING fts5(...);
```

---

## Release Workflow

This project uses [release-please](https://github.com/googleapis/release-please) for automated releases.

### Branch Strategy

| Branch | Purpose             |
| ------ | ------------------- |
| `dev`  | Active development  |
| `prod` | Production releases |

### How It Works

1. Push commits to `dev` using [conventional commits](https://www.conventionalcommits.org/)
2. Release-please maintains a Release PR (`dev` → `prod`)
3. When merged, automatic release: npm publish + GitHub release + database upload
4. Changes sync back to `dev`

See [RELEASE_WORKFLOW.md](RELEASE_WORKFLOW.md) for complete details.

---

## Configuration

### Environment Variables

| Variable          | Description             | Default                    |
| ----------------- | ----------------------- | -------------------------- |
| `DB_PATH`         | Custom database path    | `./data/mcmodding-docs.db` |
| `GITHUB_REPO_URL` | Custom repo for updates | Auto-detected              |
| `MCP_DEBUG`       | Enable debug logging    | `false`                    |

### Disabling Auto-Updates

Set `DB_PATH` to a custom location to manage updates manually:

```bash
DB_PATH=/path/to/my/database.db mcmodding-mcp
```

---

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Quick Contribution Guide

1. Fork the repository
2. Create a feature branch from `dev`
3. Make changes with conventional commits
4. Submit a PR to `dev`

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

## Acknowledgments

- [Fabric Documentation](https://docs.fabricmc.net/) - Official Fabric documentation
- [Fabric Wiki](https://wiki.fabricmc.net/) - Community wiki
- [Model Context Protocol](https://modelcontextprotocol.io/) - MCP specification
- [Transformers.js](https://huggingface.co/docs/transformers.js) - Local ML embeddings
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) - Fast SQLite bindings

---

<p align="center">
  <strong>Built with care for the Minecraft modding community</strong>
</p>
