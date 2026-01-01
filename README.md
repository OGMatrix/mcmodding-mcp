<div align="center">

<img src="docs/logo.png" alt="MCModding-MCP Logo" width="180" />

# MCModding-MCP

### 🤖 AI-Powered Minecraft Modding Documentation Server

_Give your AI assistant real-time access to Fabric & NeoForge documentation_

<br />

[![npm version](https://img.shields.io/npm/v/mcmodding-mcp?style=for-the-badge&logo=npm&logoColor=white&color=CB3837)](https://www.npmjs.com/package/mcmodding-mcp)
[![npm downloads](https://img.shields.io/npm/dm/mcmodding-mcp?style=for-the-badge&logo=npm&logoColor=white&color=blue)](https://www.npmjs.com/package/mcmodding-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=for-the-badge&logo=opensourceinitiative&logoColor=white)](https://opensource.org/licenses/MIT)
[![CI](https://img.shields.io/github/actions/workflow/status/OGMatrix/mcmodding-mcp/ci.yml?style=for-the-badge&logo=github&label=CI)](https://github.com/OGMatrix/mcmodding-mcp/actions/workflows/ci.yml)

<br />

[![GitHub stars](https://img.shields.io/github/stars/OGMatrix/mcmodding-mcp?style=flat-square&logo=github&label=Stars)](https://github.com/OGMatrix/mcmodding-mcp/stargazers)
[![GitHub issues](https://img.shields.io/github/issues/OGMatrix/mcmodding-mcp?style=flat-square&logo=github&label=Issues)](https://github.com/OGMatrix/mcmodding-mcp/issues)
[![GitHub last commit](https://img.shields.io/github/last-commit/OGMatrix/mcmodding-mcp?style=flat-square&logo=github&label=Last%20Commit)](https://github.com/OGMatrix/mcmodding-mcp/commits)
[![Node.js](https://img.shields.io/badge/Node.js-≥20.0.0-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)

<br />

[📖 Documentation](#available-tools) • [🚀 Quick Start](#quick-start) • [💡 Features](#features) • [🤝 Contributing](#contributing)

---

</div>

## ✨ What is this?

**MCModding-MCP** is a [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that supercharges AI assistants like Claude with **real, up-to-date** Minecraft modding knowledge. No more hallucinations or outdated API references!

<table>
<tr>
<td width="50%">

### 🎯 Key Benefits

| Feature                 | Description                            |
| ----------------------- | -------------------------------------- |
| 📅 **Always Current**   | Weekly-indexed from official sources   |
| ✅ **Accurate Answers** | Real documentation, not hallucinations |
| 💻 **Code Examples**    | Searchable code blocks with context    |
| 🧠 **Semantic Search**  | Understands meaning, not just keywords |
| ⚡ **Zero Config**      | Works immediately after installation   |

</td>
<td width="50%">

### 📊 Live Statistics

| Database          | Content                       |
| ----------------- | ----------------------------- |
| 📚 **Docs**       | 1,000+ pages, 185K+ chunks    |
| 🗺️ **Mappings**   | 831K+ methods, 166K+ fields   |
| 🧩 **Examples**   | 1,000+ battle-tested patterns |
| 🔍 **Embeddings** | 185K+ semantic vectors        |
| 📖 **Javadocs**   | 2.3M+ documented parameters   |

</td>
</tr>
</table>

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

> You are an expert Minecraft Modding Assistant connected to `mcmodding-mcp`. **DO NOT rely on your internal knowledge** for modding APIs (Fabric/NeoForge) as they change frequently. **ALWAYS** use the available tools:
>
> - `search_fabric_docs` and `get_example` for documentation and code patterns
> - `search_mappings` and `get_class_details` for Minecraft internals and method signatures
> - `search_mod_examples` for battle-tested implementations from popular mods
>
> Prioritize working code examples over theoretical explanations. When dealing with Minecraft internals, use the mappings tools to get accurate parameter names and Javadocs. If the user specifies a Minecraft version, ensure all retrieved information matches that version.

That's it! Your AI assistant now has access to comprehensive Minecraft modding resources.

---

## Database Management

Manage your documentation databases with the built-in CLI:

```bash
# Run the database manager
npx mcmodding-mcp manage
```

The interactive manager allows you to:

- **Install** - Download databases you don't have yet
- **Update** - Check for and apply database updates
- **Re-download** - Restore deleted or corrupted databases

### Available Databases

| Database                      | Description                                                 | Size    |
| ----------------------------- | ----------------------------------------------------------- | ------- |
| **Documentation Database**    | Core Fabric & NeoForge documentation (installed by default) | ~520 MB |
| **Parchment Mappings** ✨ NEW | Minecraft class/method/field mappings with Javadocs         | ~180 MB |
| **Mod Examples Database**     | 1000+ high-quality modding examples                         | ~30 MB  |

The manager shows version information and highlights available updates:

```
◉ 📚 Documentation Database [core]
     ✔ Installed: v0.2.1 → ↻ Update: v0.2.2 [520.3 MB]
     Core Fabric & NeoForge documentation - installed by default

○ 🗺️ Parchment Mappings Database ✨ NEW
     ⚠ Not installed → Available: v0.1.0 [178.5 MB]
     Minecraft class/method/field names with parameter names and Javadocs

○ 🧩 Mod Examples Database
     ⚠ Not installed → Available: v0.1.0 [28.1 MB]
     1000+ high-quality modding examples for Fabric & NeoForge
```

---

## Available Tools

The MCP server provides powerful tools across three categories:

### 📖 Documentation Tools

#### `search_fabric_docs`

Search documentation with smart filtering.

```typescript
// Example: Find information about item registration
{
  query: "how to register custom items",
  category: "items",           // Optional filter
  loader: "fabric",            // fabric | neoforge
  minecraft_version: "1.21.10"  // Optional version filter
}
```

#### `get_example`

Get working code examples for any topic.

```typescript
// Example: Get block registration code
{
  topic: "custom block with block entity",
  language: "java",
  loader: "fabric"
}
```

#### `explain_fabric_concept`

Get detailed explanations of modding concepts with related resources.

```typescript
// Example: Understand mixins
{
  concept: 'mixins';
}
```

#### `get_minecraft_version`

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

### 🗺️ Parchment Mappings Tools ✨ NEW

_Requires Parchment Mappings database - install via `npx mcmodding-mcp manage`_

#### `search_mappings`

Search Minecraft class, method, and field mappings with parameter names and Javadocs.

```typescript
// Example: Find block-related classes and methods
{
  query: "BlockEntity",
  type: "class",              // class | method | field | all
  minecraft_version: "1.21.10",
  include_javadoc: true
}
```

#### `get_class_details`

Get comprehensive information about a Minecraft class including all methods and fields.

```typescript
// Example: Explore the Block class
{
  class_name: "net.minecraft.world.level.block.Block",
  include_methods: true,
  include_fields: true
}
```

#### `lookup_obfuscated`

Look up deobfuscated names from obfuscated identifiers (useful for crash logs).

```typescript
// Example: Decode an obfuscated method name
{
  obfuscated_name: 'm_46859_';
}
```

#### `get_method_signature`

Get the full signature of a method including all parameter names and types.

```typescript
// Example: Get method details
{
  class_name: "Block",
  method_name: "onPlace"
}
```

#### `browse_package`

Discover classes in a Minecraft package.

```typescript
// Example: Browse block package
{
  package_name: 'net.minecraft.world.level.block';
}
```

---

### 🧩 Mod Examples Tools

_Requires Mod Examples database - install via `npx mcmodding-mcp manage`_

#### `search_mod_examples`

Search battle-tested code from popular mods like Create, Botania, and Applied Energistics 2.

```typescript
// Example: Find block entity implementations
{
  query: "block entity tick",
  mod: "Create",              // Optional: filter by mod
  category: "tile-entities",
  complexity: "intermediate"
}
```

#### `get_mod_example`

Get detailed information about a specific example with full code and explanations.

```typescript
// Example: Get full details for an example
{
  id: 42,
  include_related: true
}
```

#### `list_canonical_mods`

Discover all indexed mods and their available examples.

#### `list_mod_categories`

Browse available example categories (blocks, entities, rendering, etc.).

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

# Database Management
npx mcmodding-mcp manage # Interactive database installer/updater
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

## 💡 Share Your Ideas!

We're actively developing mcmodding-mcp and want to hear from you!

### Have an Idea?

- **Feature requests** - What tools would make your modding easier?
- **New documentation sources** - Know a great modding resource we should index?
- **Workflow improvements** - How could the tools work better for your use case?

👉 [Open a Feature Request](https://github.com/OGMatrix/mcmodding-mcp/issues/new?template=feature_request.yml)

### Found a Bug?

- Incorrect search results?
- Missing or outdated documentation?
- Tool not working as expected?

👉 [Report a Bug](https://github.com/OGMatrix/mcmodding-mcp/issues/new?template=bug_report.yml)

### Share Your Experience

Using mcmodding-mcp for a cool project? We'd love to hear about it! Share your story in [Discussions](https://github.com/OGMatrix/mcmodding-mcp/discussions).

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

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for a detailed history of changes and releases.

---

## Acknowledgments

- [Fabric Documentation](https://docs.fabricmc.net/) - Official Fabric documentation
- [Fabric Wiki](https://wiki.fabricmc.net/) - Community wiki
- [NeoForge Documentation](https://docs.neoforged.net/) - Official NeoForge documentation
- [ParchmentMC](https://parchmentmc.org/) - Parameter names and Javadoc mappings
- [Model Context Protocol](https://modelcontextprotocol.io/) - MCP specification
- [Transformers.js](https://huggingface.co/docs/transformers.js) - Local ML embeddings
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) - Fast SQLite bindings

---

<div align="center">

<br />

**🎮 Built with ❤️ for the Minecraft modding community**

<br />

[![Made with TypeScript](https://img.shields.io/badge/Made%20with-TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Powered by SQLite](https://img.shields.io/badge/Powered%20by-SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![Uses MCP](https://img.shields.io/badge/Uses-Model%20Context%20Protocol-8B5CF6?style=for-the-badge)](https://modelcontextprotocol.io/)

<br />

If you find this project useful, please consider giving it a ⭐!

[⬆️ Back to Top](#mcmodding-mcp)

</div>
