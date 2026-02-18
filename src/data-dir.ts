/**
 * Platform-appropriate shared data directory for mcmodding-mcp.
 *
 * Instead of storing databases relative to `process.cwd()` (which changes per
 * project and per MCP client), we use a single, shared, platform-standard
 * location so that:
 *   - `mcmodding-mcp manage` and the MCP server always read/write the same DB
 *   - The ~50 MB database is downloaded once and shared across all projects
 *   - No need to .gitignore anything in project directories
 *
 * Override order:
 *   1. Explicit `dbPath` argument (always wins)
 *   2. `MCMODDING_DATA_DIR` environment variable
 *   3. Platform default (XDG on Linux, Application Support on macOS, APPDATA on Windows)
 */

import os from 'os';
import path from 'path';

/**
 * Get the default platform-appropriate shared data directory.
 *
 * - Linux:   $XDG_DATA_HOME/mcmodding-mcp  (default ~/.local/share/mcmodding-mcp)
 * - macOS:   ~/Library/Application Support/mcmodding-mcp
 * - Windows: %APPDATA%/mcmodding-mcp
 */
export function getDefaultDataDir(): string {
  // Allow full override via environment variable
  if (process.env.MCMODDING_DATA_DIR) {
    return process.env.MCMODDING_DATA_DIR;
  }

  const platform = process.platform;

  if (platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'mcmodding-mcp');
  }

  if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'mcmodding-mcp');
  }

  // Linux / FreeBSD / others: follow XDG Base Directory Specification
  const xdgDataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(xdgDataHome, 'mcmodding-mcp');
}

/**
 * Get the default path for a specific database file inside the shared data directory.
 */
export function getDefaultDbPath(fileName: string): string {
  return path.join(getDefaultDataDir(), fileName);
}
