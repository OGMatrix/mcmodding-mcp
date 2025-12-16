# Contributing to mcmodding-mcp

Thank you for your interest in contributing! This guide will help you get started.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Branch Strategy](#branch-strategy)
- [Making Changes](#making-changes)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)
- [Code Standards](#code-standards)
- [Testing](#testing)
- [Documentation](#documentation)

---

## Code of Conduct

- Be respectful and constructive
- Welcome newcomers and help them learn
- Focus on the code, not the person
- Accept feedback gracefully

---

## Reporting Issues

We use GitHub Issues to track bugs and feature requests.

- **Bugs**: If you find a bug, please use the [Bug Report template](https://github.com/OGMatrix/mcmodding-mcp/issues/new?template=bug_report.yml).
- **Features**: If you have an idea, please use the [Feature Request template](https://github.com/OGMatrix/mcmodding-mcp/issues/new?template=feature_request.yml).
- **Questions**: For general questions, please use the [Question template](https://github.com/OGMatrix/mcmodding-mcp/issues/new?template=question.yml) or GitHub Discussions.

Please search existing issues before opening a new one to avoid duplicates.

---

## Getting Started

### Prerequisites

- Node.js 18+ (20.x recommended)
- npm 9+
- Git

### Fork and Clone

```bash
# Fork the repository on GitHub, then clone your fork
git clone https://github.com/YOUR_USERNAME/mcmodding-mcp.git
cd mcmodding-mcp

# Add upstream remote
git remote add upstream https://github.com/OGMatrix/mcmodding-mcp.git

# Install dependencies
npm install
```

---

## Development Setup

### Available Commands

```bash
# Development
npm run dev              # Start with hot reload
npm run build            # Compile TypeScript
npm run typecheck        # Type checking only
npm run lint             # ESLint
npm run lint:fix         # Fix lint issues
npm run format           # Prettier formatting
npm run format:check     # Check formatting

# Testing
npm test                 # Run tests once
npm run test:watch       # Watch mode
npm run test:coverage    # With coverage report

# Documentation Indexing
npm run index-docs       # Index with embeddings
npm run index-docs:prod  # Full re-index for production

# Validation (runs before commit)
npm run validate         # typecheck + lint + test + build
```

### IDE Setup

**VS Code** (Recommended):

- Install recommended extensions (prompt appears on open)
- Settings are pre-configured in `.vscode/`

**Other IDEs**:

- Enable ESLint integration
- Enable Prettier for formatting
- Configure TypeScript language service

---

## Branch Strategy

We use a two-branch workflow:

```
feature/* ──┐
            ├──► dev ──► Release PR ──► prod ──► Release
bugfix/*  ──┘
```

| Branch      | Purpose                                 |
| ----------- | --------------------------------------- |
| `dev`       | Active development, all PRs target here |
| `prod`      | Production releases only                |
| `feature/*` | New features                            |
| `bugfix/*`  | Bug fixes                               |
| `docs/*`    | Documentation updates                   |

### Creating a Feature Branch

```bash
# Sync with upstream
git checkout dev
git pull upstream dev

# Create feature branch
git checkout -b feature/my-awesome-feature

# Make changes, commit, push
git push -u origin feature/my-awesome-feature

# Create PR to dev (not prod!)
```

---

## Making Changes

### Adding a New MCP Tool

1. **Create the handler** in `src/tools/`:

```typescript
// src/tools/myNewTool.ts
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export interface MyToolParams {
  query: string;
  limit?: number;
}

export async function handleMyTool(params: MyToolParams): Promise<CallToolResult> {
  // Validate input
  if (!params.query) {
    return {
      content: [{ type: 'text', text: 'Error: query is required' }],
      isError: true,
    };
  }

  // Implementation
  const result = await doSomething(params.query);

  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  };
}
```

2. **Register in `src/index.ts`**:

```typescript
// Add import
import { handleMyTool } from './tools/myNewTool.js';

// Add to tools list
{
  name: 'my_new_tool',
  description: 'Description of what this tool does',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      limit: { type: 'number', description: 'Max results' },
    },
    required: ['query'],
  },
}

// Add handler case
case 'my_new_tool':
  return handleMyTool({
    query: args?.query as string,
    limit: args?.limit as number,
  });
```

3. **Add tests** in `src/tools/myNewTool.test.ts`

4. **Update README.md** with usage examples

### Modifying the Indexer

The indexer components are in `src/indexer/`:

| File            | Purpose                        |
| --------------- | ------------------------------ |
| `crawler.ts`    | HTTP fetching and HTML parsing |
| `chunker.ts`    | Text splitting and chunking    |
| `embeddings.ts` | Semantic vector generation     |
| `store.ts`      | SQLite database operations     |
| `sitemap.ts`    | Sitemap parsing                |

When modifying:

- Test with `npm run index-docs`
- Check memory usage with large datasets
- Ensure backward compatibility with existing databases

### Modifying Services

Services in `src/services/` contain business logic:

| File                 | Purpose                   |
| -------------------- | ------------------------- |
| `search-service.ts`  | Search orchestration      |
| `concept-service.ts` | Concept explanation logic |
| `search-utils.ts`    | Query parsing utilities   |

---

## Commit Guidelines

We use [Conventional Commits](https://www.conventionalcommits.org/) for automatic changelog generation.

### Format

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types

| Type       | Description             | Version Bump |
| ---------- | ----------------------- | ------------ |
| `feat`     | New feature             | Minor        |
| `fix`      | Bug fix                 | Patch        |
| `perf`     | Performance improvement | Patch        |
| `refactor` | Code refactoring        | None         |
| `docs`     | Documentation           | None         |
| `style`    | Code style (formatting) | None         |
| `test`     | Tests                   | None         |
| `build`    | Build system            | None         |
| `ci`       | CI/CD                   | None         |
| `chore`    | Maintenance             | None         |

### Scopes

Common scopes (optional but helpful):

- `search` - Search functionality
- `indexer` - Documentation indexing
- `tools` - MCP tools
- `store` - Database operations
- `embeddings` - Semantic search
- `versioning` - Auto-update system

### Examples

```bash
# Feature
git commit -m "feat(search): add fuzzy matching support"

# Bug fix
git commit -m "fix(indexer): handle malformed HTML gracefully"

# Performance
git commit -m "perf(embeddings): batch process in chunks of 500"

# Breaking change
git commit -m "feat(tools)!: rename search_docs to search_fabric_docs

BREAKING CHANGE: Tool name changed for clarity"

# Multi-line with body
git commit -m "fix(chunker): prevent infinite loop on edge cases

The chunker could enter an infinite loop when overlap size
exceeded the content length. Added bounds checking to ensure
forward progress is always made."
```

---

## Pull Request Process

### Before Submitting

```bash
# Ensure everything passes
npm run validate

# Check for any TODOs you forgot
grep -r "TODO" src/
```

### PR Template

When you open a Pull Request, a template will automatically load. Please fill out all sections:

- **Description**: What changed and why.
- **Related Issue**: Link to the issue (e.g., `Fixes #123`).
- **Type of Change**: Check the appropriate box.
- **Checklist**: Ensure you've completed all steps.

### PR Checklist

- [ ] Branch is based on latest `dev`
- [ ] All tests pass (`npm test`)
- [ ] Code is formatted (`npm run format`)
- [ ] No lint errors (`npm run lint`)
- [ ] Types are correct (`npm run typecheck`)
- [ ] Commits follow conventional format
- [ ] PR targets `dev` branch (not `prod`)
- [ ] Description explains the changes
- [ ] Documentation updated if needed

### PR Title

Use conventional commit format:

```
feat(search): add category filtering
fix(indexer): resolve memory leak in crawler
docs: update installation instructions
```

### PR Description Template

```markdown
## Summary

Brief description of what this PR does and why.

## Changes

- List of specific changes
- Another change

## Testing

How you tested these changes:

- [ ] Unit tests added/updated
- [ ] Manual testing performed
- [ ] Edge cases considered

## Screenshots (if applicable)

## Related Issues

Fixes #123
Related to #456
```

### Review Process

1. Submit PR to `dev`
2. CI runs automatically
3. Maintainer reviews code
4. Address feedback if needed
5. Maintainer merges when approved

---

## Code Standards

### TypeScript

```typescript
// Use explicit types for function parameters and returns
function processData(input: string, options?: ProcessOptions): ProcessResult {
  // Implementation
}

// Use interfaces for object shapes
interface ProcessOptions {
  maxLength?: number;
  format?: 'json' | 'text';
}

// Use type for unions/intersections
type Result = Success | Failure;

// Avoid `any` - use `unknown` if type is truly unknown
function handleUnknown(data: unknown): void {
  if (typeof data === 'string') {
    // Now TypeScript knows it's a string
  }
}
```

### Error Handling

```typescript
// Use try-catch for async operations
try {
  const result = await fetchData();
  return { success: true, data: result };
} catch (error) {
  console.error('[ModuleName] Error:', error);
  return { success: false, error: String(error) };
}

// Return structured errors from tool handlers
return {
  content: [{ type: 'text', text: `Error: ${message}` }],
  isError: true,
};
```

### Naming Conventions

```typescript
// Files: kebab-case
// src/tools/search-docs.ts

// Classes: PascalCase
class DocumentStore {}

// Functions/methods: camelCase
function searchDocuments() {}

// Constants: SCREAMING_SNAKE_CASE
const MAX_CHUNK_SIZE = 1000;

// Interfaces: PascalCase with descriptive names
interface SearchResult {}
interface SearchOptions {}
```

---

## Testing

### Writing Tests

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { myFunction } from './myModule.js';

describe('myFunction', () => {
  beforeEach(() => {
    // Setup before each test
  });

  it('should return expected result for valid input', () => {
    const result = myFunction('valid input');
    expect(result).toBe('expected output');
  });

  it('should handle edge cases', () => {
    expect(myFunction('')).toBe('default');
    expect(myFunction(null as any)).toThrow();
  });

  it('should work with async operations', async () => {
    const result = await myAsyncFunction();
    expect(result).toMatchObject({ status: 'success' });
  });
});
```

### Test Coverage

- Aim for >80% coverage on new code
- All bug fixes should include regression tests
- Test edge cases and error conditions

### Running Tests

```bash
# Run all tests
npm test

# Watch mode (re-runs on changes)
npm run test:watch

# With coverage report
npm run test:coverage
```

---

## Documentation

### Code Comments

````typescript
/**
 * Search the documentation index for relevant content.
 *
 * Uses a hybrid approach combining FTS5 full-text search
 * with semantic embeddings for best results.
 *
 * @param query - The search query string
 * @param options - Optional search filters
 * @returns Array of search results sorted by relevance
 * @throws {DatabaseError} If the database connection fails
 *
 * @example
 * ```typescript
 * const results = await searchDocs('mixin tutorial', {
 *   category: 'getting-started',
 *   limit: 10,
 * });
 * ```
 */
export async function searchDocs(query: string, options?: SearchOptions): Promise<SearchResult[]> {
  // Implementation
}
````

### README Updates

Update the README when:

- Adding new tools or features
- Changing configuration options
- Modifying installation steps
- Adding new dependencies

---

## Questions?

- **Bug reports**: [Open an issue](https://github.com/OGMatrix/mcmodding-mcp/issues)
- **Feature requests**: [Open an issue](https://github.com/OGMatrix/mcmodding-mcp/issues)
- **Questions**: [Start a discussion](https://github.com/OGMatrix/mcmodding-mcp/discussions)

---

## Thank You!

Every contribution helps make Minecraft modding with AI assistants better for the entire community. We appreciate your time and effort!
