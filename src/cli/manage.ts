/* eslint-disable no-console */
/* eslint-disable no-control-regex */
import fs from 'fs';
import path from 'path';
import https from 'https';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

const CONFIG = {
  repoOwner: 'OGMatrix',
  repoName: 'mcmodding-mcp',
  // Go up two levels from dist/cli/ or src/cli/ to get to root, then into data
  dataDir: path.join(__dirname, '..', '..', 'data'),
  userAgent: 'mcmodding-mcp-installer',
};

interface OptionalDb {
  id: string;
  name: string;
  fileName: string;
  manifestName: string;
  description: string;
  tagPrefix: string;
  icon: string;
  isRequired?: boolean;
  localVersion?: string | null;
  remoteInfo?: RemoteInfo | null;
  selected?: boolean;
  hasUpdate?: boolean;
}

interface RemoteInfo {
  version: string;
  releaseId: number;
  downloadUrl: string;
  manifestUrl: string | null;
  size: number;
  publishedAt: string;
  hash?: string;
}

interface GitHubAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface GitHubRelease {
  id: number;
  tag_name: string;
  published_at: string;
  assets: GitHubAsset[];
}

const AVAILABLE_DBS: OptionalDb[] = [
  {
    id: 'mcmodding-docs',
    name: 'Documentation Database',
    fileName: 'mcmodding-docs.db',
    manifestName: 'db-manifest.json',
    description: 'Core Fabric & NeoForge documentation - installed by default',
    tagPrefix: 'v',
    icon: '📚',
    isRequired: true,
  },
  {
    id: 'mod-examples',
    name: 'Mod Examples Database',
    fileName: 'mod-examples.db',
    manifestName: 'mod-examples-manifest.json',
    description: '1000+ high-quality modding examples for Fabric & NeoForge',
    tagPrefix: 'examples-v',
    icon: '🧩',
  },
  {
    id: 'parchment-mappings',
    name: 'Parchment Mappings Database',
    fileName: 'parchment-mappings.db',
    manifestName: 'parchment-mappings-manifest.json',
    description: 'Minecraft class/method/field mappings with parameter names & Javadocs',
    tagPrefix: 'mappings-v',
    icon: '🗺️',
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// ANSI COLORS & STYLES
// ═══════════════════════════════════════════════════════════════════════════════

const isColorSupported = process.stdout.isTTY && !process.env.NO_COLOR;

const c = {
  reset: isColorSupported ? '\x1b[0m' : '',
  bold: isColorSupported ? '\x1b[1m' : '',
  dim: isColorSupported ? '\x1b[2m' : '',
  italic: isColorSupported ? '\x1b[3m' : '',
  underline: isColorSupported ? '\x1b[4m' : '',
  black: isColorSupported ? '\x1b[30m' : '',
  red: isColorSupported ? '\x1b[31m' : '',
  green: isColorSupported ? '\x1b[32m' : '',
  yellow: isColorSupported ? '\x1b[33m' : '',
  blue: isColorSupported ? '\x1b[34m' : '',
  magenta: isColorSupported ? '\x1b[35m' : '',
  cyan: isColorSupported ? '\x1b[36m' : '',
  white: isColorSupported ? '\x1b[37m' : '',
  brightBlack: isColorSupported ? '\x1b[90m' : '',
  brightRed: isColorSupported ? '\x1b[91m' : '',
  brightGreen: isColorSupported ? '\x1b[92m' : '',
  brightYellow: isColorSupported ? '\x1b[93m' : '',
  brightBlue: isColorSupported ? '\x1b[94m' : '',
  brightMagenta: isColorSupported ? '\x1b[95m' : '',
  brightCyan: isColorSupported ? '\x1b[96m' : '',
  brightWhite: isColorSupported ? '\x1b[97m' : '',
  bgBlue: isColorSupported ? '\x1b[44m' : '',
  clearLine: isColorSupported ? '\x1b[2K' : '',
  cursorUp: isColorSupported ? '\x1b[1A' : '',
  cursorHide: isColorSupported ? '\x1b[?25l' : '',
  cursorShow: isColorSupported ? '\x1b[?25h' : '',
};

const sym = {
  topLeft: '╔',
  topRight: '╗',
  bottomLeft: '╚',
  bottomRight: '╝',
  horizontal: '═',
  vertical: '║',
  sTopLeft: '┌',
  sTopRight: '┐',
  sBottomLeft: '└',
  sBottomRight: '┘',
  sHorizontal: '─',
  sVertical: '│',
  barFull: '█',
  barThreeQuarter: '▓',
  barHalf: '▒',
  barQuarter: '░',
  barEmpty: '░',
  check: '✔',
  cross: '✖',
  warning: '⚠',
  info: 'ℹ',
  star: '★',
  sparkle: '✨',
  rocket: '🚀',
  package: '📦',
  database: '🗄️',
  download: '⬇',
  shield: '🛡️',
  clock: '⏱',
  lightning: '⚡',
  arrowRight: '▶',
  dot: '●',
  circle: '○',
  selected: '◉',
  unselected: '○',
  update: '↻',
  cube: '◆',
  pause: '⏸',
  play: '▶',
  stop: '⏹',
};

// ANSI escape sequences for cursor control
const cursor = {
  save: isColorSupported ? '\x1b[s' : '',
  restore: isColorSupported ? '\x1b[u' : '',
  toColumn: (col: number) => (isColorSupported ? `\x1b[${col}G` : ''),
  up: (n: number) => (isColorSupported ? `\x1b[${n}A` : ''),
  down: (n: number) => (isColorSupported ? `\x1b[${n}B` : ''),
};

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

function getTerminalWidth() {
  return process.stdout.columns || 80;
}

function centerText(text: string, width: number) {
  const cleanText = text.replace(/\x1b\[[0-9;]*m/g, '');
  const totalPadding = Math.max(0, width - cleanText.length);
  const leftPadding = Math.floor(totalPadding / 2);
  const rightPadding = totalPadding - leftPadding;
  return ' '.repeat(leftPadding) + text + ' '.repeat(rightPadding);
}

function formatBytes(bytes: number) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatSpeed(bytesPerSecond: number) {
  return formatBytes(bytesPerSecond) + '/s';
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return '--:--';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m ${secs.toString().padStart(2, '0')}s`;
}

function padLine(text: string, width: number): string {
  const cleanText = text.replace(/\x1b\[[0-9;]*m/g, '');
  const padding = Math.max(0, width - cleanText.length);
  return text + ' '.repeat(padding);
}

// ═══════════════════════════════════════════════════════════════════════════════
// API & NETWORK
// ═══════════════════════════════════════════════════════════════════════════════

async function fetchJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const options = {
      headers: { 'User-Agent': CONFIG.userAgent },
    };
    https
      .get(url, options, (res) => {
        // Handle redirects (GitHub release assets redirect to the actual download URL)
        if (res.statusCode === 301 || res.statusCode === 302) {
          if (!res.headers.location) {
            return reject(new Error('Redirect location missing'));
          }
          res.resume();
          fetchJson(res.headers.location).then(resolve).catch(reject);
          return;
        }

        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`Request failed with status code ${res.statusCode}`));
        }
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        });
      })
      .on('error', (err) => reject(err instanceof Error ? err : new Error(String(err))));
  });
}

async function downloadFile(
  url: string,
  destPath: string,
  onProgress?: (current: number, total: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const options = {
      headers: { 'User-Agent': CONFIG.userAgent },
    };

    https
      .get(url, options, (res) => {
        if (res.statusCode === 302 || res.statusCode === 301) {
          if (!res.headers.location) {
            return reject(new Error('Redirect location missing'));
          }
          file.close();
          downloadFile(res.headers.location, destPath, onProgress).then(resolve).catch(reject);
          return;
        }

        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`Download failed with status code ${res.statusCode}`));
        }

        const totalSize = parseInt(res.headers['content-length'] || '0', 10);
        let downloadedSize = 0;

        res.on('data', (chunk: Buffer) => {
          downloadedSize += chunk.length;
          file.write(chunk);

          if (onProgress) {
            onProgress(downloadedSize, totalSize);
          }
        });

        res.on('end', () => {
          file.end();
          resolve();
        });

        res.on('error', (err) => {
          fs.unlink(destPath, () => {});
          reject(err);
        });
      })
      .on('error', (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
  });
}

interface DownloadController {
  promise: Promise<void>;
  abort: () => void;
}

function downloadFileInteractive(
  url: string,
  destPath: string,
  progress: ProgressDisplay
): DownloadController {
  let abortController: { abort: () => void } | null = null;
  let pauseResolve: (() => void) | null = null;
  let keyHandler: ((key: Buffer) => void) | null = null;
  let currentRes: import('http').IncomingMessage | null = null;

  const cleanup = () => {
    if (keyHandler) {
      process.stdin.removeListener('data', keyHandler);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    }
  };

  const promise = new Promise<void>((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const options = {
      headers: { 'User-Agent': CONFIG.userAgent },
    };

    // Set up keyboard input
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    keyHandler = (key: Buffer) => {
      const keyStr = key.toString().toLowerCase();

      if (keyStr === 'c' || keyStr === '\u0003') {
        // Cancel - mark as cancelled but don't reject yet
        progress.cancel();
        if (currentRes) {
          currentRes.destroy();
        }
        cleanup();
        fs.unlink(destPath, () => {});
        reject(new Error('Download cancelled by user'));
      } else if (keyStr === 'p' || keyStr === ' ') {
        // Toggle Pause/Resume
        progress.togglePause();
        if (progress.paused) {
          if (currentRes) {
            currentRes.pause();
          }
        } else {
          if (currentRes) {
            currentRes.resume();
          }
          if (pauseResolve) {
            pauseResolve();
            pauseResolve = null;
          }
        }
        // Force immediate redraw to show state change
        progress.forceRedraw();
      } else if (keyStr === 'i') {
        // Toggle info
        progress.toggleDetail();
      }
    };

    process.stdin.on('data', keyHandler);

    const makeRequest = (requestUrl: string) => {
      const req = https.get(requestUrl, options, (res) => {
        currentRes = res;

        if (res.statusCode === 302 || res.statusCode === 301) {
          if (!res.headers.location) {
            cleanup();
            return reject(new Error('Redirect location missing'));
          }
          makeRequest(res.headers.location);
          return;
        }

        if (res.statusCode !== 200) {
          res.resume();
          cleanup();
          return reject(new Error(`Download failed with status code ${res.statusCode}`));
        }

        const totalSize = parseInt(res.headers['content-length'] || '0', 10);
        let downloadedSize = 0;

        res.on('data', (chunk: Buffer) => {
          if (progress.cancelled) return;

          downloadedSize += chunk.length;
          file.write(chunk);
          progress.update(downloadedSize, totalSize);
        });

        res.on('end', () => {
          file.end();
          cleanup();
          if (!progress.cancelled) {
            resolve();
          }
        });

        res.on('error', (err) => {
          cleanup();
          fs.unlink(destPath, () => {});
          reject(err);
        });
      });

      req.on('error', (err) => {
        cleanup();
        fs.unlink(destPath, () => {});
        reject(err);
      });

      abortController = {
        abort: () => {
          req.destroy();
        },
      };
    };

    makeRequest(url);
  });

  return {
    promise,
    abort: () => {
      if (abortController) {
        abortController.abort();
      }
      cleanup();
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// UI COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

function printHeader() {
  console.clear();
  const width = Math.min(getTerminalWidth(), 80);
  const innerWidth = width - 4;

  console.log(
    c.brightCyan + sym.topLeft + sym.horizontal.repeat(width - 2) + sym.topRight + c.reset
  );
  console.log(
    c.brightCyan +
      sym.vertical +
      c.reset +
      centerText(`${c.brightWhite}${c.bold}MCModding-MCP Database Manager${c.reset}`, innerWidth) +
      c.brightCyan +
      sym.vertical +
      c.reset
  );
  console.log(
    c.brightCyan +
      sym.vertical +
      c.reset +
      centerText(
        `${c.dim}Install, update, and manage your documentation databases${c.reset}`,
        innerWidth
      ) +
      c.brightCyan +
      sym.vertical +
      c.reset
  );
  console.log(
    c.brightCyan + sym.bottomLeft + sym.horizontal.repeat(width - 2) + sym.bottomRight + c.reset
  );
  console.log();
}

class ProgressDisplay {
  private lines = 0;
  private lastUpdate = 0;
  private label: string;
  private startTime: number;
  private speeds: number[] = [];
  private detailedView = false;
  private isPaused = false;
  private isCancelled = false;
  private lastDownloaded = 0;
  private lastTotal = 0;
  private speedCalcDownloaded = 0;
  private lastSpeedTime = 0;
  private initialized = false;

  constructor(label = 'Downloading') {
    this.label = label;
    this.startTime = Date.now();
    this.lastSpeedTime = this.startTime;
  }

  get paused() {
    return this.isPaused;
  }

  get cancelled() {
    return this.isCancelled;
  }

  togglePause() {
    this.isPaused = !this.isPaused;
    if (!this.isPaused) {
      // Reset speed calculation on resume
      this.lastSpeedTime = Date.now();
      this.speedCalcDownloaded = this.lastDownloaded;
    }
  }

  cancel() {
    this.isCancelled = true;
  }

  toggleDetail() {
    this.detailedView = !this.detailedView;
  }

  forceRedraw() {
    this.lastUpdate = 0;
    // Trigger redraw with last known values
    if (this.lastTotal > 0) {
      this.update(this.lastDownloaded, this.lastTotal);
    }
  }

  private calculateSpeed(downloaded: number): number {
    const now = Date.now();
    const timeDelta = (now - this.lastSpeedTime) / 1000;

    if (timeDelta >= 0.5) {
      const bytesDelta = downloaded - this.speedCalcDownloaded;
      const instantSpeed = bytesDelta / timeDelta;
      this.speeds.push(instantSpeed);
      if (this.speeds.length > 5) this.speeds.shift();
      this.speedCalcDownloaded = downloaded;
      this.lastSpeedTime = now;
    }

    if (this.speeds.length === 0) return 0;
    return this.speeds.reduce((a, b) => a + b, 0) / this.speeds.length;
  }

  update(downloaded: number, total: number) {
    if (this.isCancelled) return;

    // Store values for forceRedraw
    this.lastDownloaded = downloaded;
    this.lastTotal = total;

    const now = Date.now();
    // Throttle updates but allow first update immediately
    if (this.initialized && now - this.lastUpdate < 80) return;
    this.lastUpdate = now;

    const width = Math.min(getTerminalWidth(), 80);
    const barWidth = Math.max(10, width - 35);

    const percentage = total > 0 ? Math.min(100, (downloaded / total) * 100) : 0;
    const filledWidth = Math.round((percentage / 100) * barWidth);
    const emptyWidth = barWidth - filledWidth;

    const filledBar = c.brightGreen + sym.barFull.repeat(filledWidth) + c.reset;
    const emptyBar = c.brightBlack + sym.barEmpty.repeat(emptyWidth) + c.reset;

    const speed = this.isPaused ? 0 : this.calculateSpeed(downloaded);
    const eta = speed > 0 ? (total - downloaded) / speed : 0;
    const elapsed = (now - this.startTime) / 1000;

    const sizeStr = `${c.white}${formatBytes(downloaded)}${c.brightBlack}/${c.cyan}${formatBytes(total)}${c.reset}`;
    const speedStr = this.isPaused
      ? `${c.yellow}${sym.pause} Paused${c.reset}`
      : `${c.brightGreen}${formatSpeed(speed)}${c.reset}`;
    const etaStr = `${c.brightMagenta}${formatTime(eta)}${c.reset}`;

    // Status icon and text with clear colors
    const statusIcon = this.isPaused ? `${c.yellow}${sym.pause}` : `${c.brightCyan}${sym.download}`;
    const statusText = this.isPaused ? `${c.yellow}Paused` : `${c.brightCyan}${this.label}`;

    const lines: string[] = [];

    // Line 1: Status
    lines.push(padLine(`${statusIcon} ${statusText}...${c.reset}`, width));

    // Line 2: Progress bar with percentage color based on progress
    const pctColor =
      percentage >= 100 ? c.brightGreen : percentage >= 50 ? c.brightCyan : c.brightYellow;
    const progressLine = `${filledBar}${emptyBar} ${pctColor}${percentage.toFixed(1)}%${c.reset}`;
    lines.push(padLine(progressLine, width));

    // Line 3: Stats - using distinct colors
    const statsLine = `${sizeStr}  ${c.brightBlack}${sym.lightning}${c.reset} ${speedStr}  ${c.brightBlack}${sym.clock}${c.reset} ${etaStr}`;
    lines.push(padLine(statsLine, width));

    // Line 4: Detailed view (optional)
    if (this.detailedView) {
      const avgSpeed = elapsed > 0 ? formatSpeed(downloaded / elapsed) : '0 B/s';
      const detailLine = `${c.brightBlack}Elapsed: ${c.brightMagenta}${formatTime(elapsed)}${c.brightBlack}  Average: ${c.brightGreen}${avgSpeed}${c.reset}`;
      lines.push(padLine(detailLine, width));
    }

    // Line 5: Keybinds help - clear action colors
    const pauseKey = this.isPaused ? c.brightGreen : c.yellow;
    const pauseAction = this.isPaused ? 'Resume' : 'Pause';
    const pauseHint = `${pauseKey}[P]${c.reset} ${c.white}${pauseAction}${c.reset}`;
    const cancelHint = `${c.brightRed}[C]${c.reset} ${c.white}Cancel${c.reset}`;
    const infoState = this.detailedView
      ? `${c.brightGreen}on${c.reset}`
      : `${c.brightBlack}off${c.reset}`;
    const infoHint = `${c.cyan}[I]${c.reset} ${c.white}Info${c.reset} ${infoState}`;
    lines.push(padLine(`${pauseHint}  ${cancelHint}  ${infoHint}`, width));

    // Build output buffer - move cursor up if we've already drawn, then overwrite
    let output = '';
    if (this.initialized) {
      // Move up by the previous line count
      output += cursor.up(this.lines);
    }
    output += c.cursorHide;
    output += lines.map((line) => cursor.toColumn(1) + line).join('\n') + '\n';

    // If we have fewer lines now, clear the stale lines at the bottom
    if (this.initialized && lines.length < this.lines) {
      const extraLines = this.lines - lines.length;
      for (let i = 0; i < extraLines; i++) {
        output += cursor.toColumn(1) + ' '.repeat(width) + '\n';
      }
      // Move cursor back up to end of our new content
      output += cursor.up(extraLines);
    }

    process.stdout.write(output);
    this.lines = lines.length;
    this.initialized = true;
  }

  finish(success = true, message = '') {
    // Move up and clear our lines
    if (this.initialized && this.lines > 0) {
      process.stdout.write(cursor.up(this.lines));
      const width = Math.min(getTerminalWidth(), 80);
      for (let i = 0; i < this.lines; i++) {
        process.stdout.write(cursor.toColumn(1) + ' '.repeat(width) + '\n');
      }
      process.stdout.write(cursor.up(this.lines));
    }

    const icon = success ? c.brightGreen + sym.check : c.brightRed + sym.cross;
    const color = success ? c.brightGreen : c.brightRed;
    process.stdout.write(`${icon}${c.reset} ${color}${message}${c.reset}\n` + c.cursorShow);
    this.lines = 0;
    this.initialized = false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// LOGIC
// ═══════════════════════════════════════════════════════════════════════════════

function getLocalVersion(dbConfig: OptionalDb): string | null {
  const manifestPath = path.join(CONFIG.dataDir, dbConfig.manifestName);
  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { version: string };
      return manifest.version;
    } catch {
      return null;
    }
  }
  return null;
}

async function getRemoteVersion(dbConfig: OptionalDb): Promise<RemoteInfo | null> {
  try {
    // Fetch releases from GitHub
    const releases = (await fetchJson(
      `https://api.github.com/repos/${CONFIG.repoOwner}/${CONFIG.repoName}/releases`
    )) as GitHubRelease[];

    // Find the latest release matching the tag prefix
    const release = releases.find((r) => r.tag_name.startsWith(dbConfig.tagPrefix));

    if (!release) return null;

    // Extract version from tag (e.g., examples-v0.1.0 -> 0.1.0)
    let version = release.tag_name.replace(dbConfig.tagPrefix, '');

    // Find assets
    const dbAsset = release.assets.find((a) => a.name === dbConfig.fileName);
    const manifestAsset = release.assets.find((a) => a.name === dbConfig.manifestName);

    if (!dbAsset) return null;

    // If manifest exists, try to get the real version from it
    // This handles cases where DB version differs from Release tag
    if (manifestAsset) {
      try {
        const manifest = (await fetchJson(manifestAsset.browser_download_url)) as {
          version: string;
        };
        if (manifest && manifest.version) {
          version = manifest.version;
        }
      } catch {
        // Fallback to tag version if manifest fetch fails
      }
    }

    return {
      version,
      releaseId: release.id,
      downloadUrl: dbAsset.browser_download_url,
      manifestUrl: manifestAsset ? manifestAsset.browser_download_url : null,
      size: dbAsset.size,
      publishedAt: release.published_at,
    };
  } catch {
    return null;
  }
}

async function promptSelection(options: OptionalDb[]): Promise<OptionalDb[]> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let selectedIndex = 0;

  const render = () => {
    printHeader();
    console.log(`${c.brightWhite}Select databases to install or update:${c.reset}\n`);

    options.forEach((opt, idx) => {
      const isSelected = idx === selectedIndex;
      const prefix = isSelected ? `${c.brightCyan}${sym.arrowRight} ` : '  ';
      const checkbox = opt.selected
        ? `${c.brightGreen}${sym.selected}${c.reset}`
        : `${c.brightBlack}${sym.unselected}${c.reset}`;
      const style = isSelected ? c.brightWhite + c.bold : c.white;
      const requiredBadge = opt.isRequired ? ` ${c.brightBlack}[core]${c.reset}` : '';

      console.log(`${prefix}${checkbox} ${style}${opt.icon} ${opt.name}${c.reset}${requiredBadge}`);

      // Status line with clear color hierarchy
      let status = '';
      if (opt.localVersion) {
        status += `${c.green}${sym.check} v${opt.localVersion}${c.reset}`;
      } else {
        status += `${c.yellow}${sym.warning} Not installed${c.reset}`;
      }

      if (opt.remoteInfo) {
        if (opt.hasUpdate) {
          status += ` ${c.brightBlack}→${c.reset} ${c.brightYellow}v${opt.remoteInfo.version}${c.reset}`;
        } else if (!opt.localVersion) {
          status += ` ${c.brightBlack}→${c.reset} ${c.cyan}v${opt.remoteInfo.version}${c.reset}`;
        } else {
          status += ` ${c.brightBlack}(up to date)${c.reset}`;
        }
        status += ` ${c.brightBlack}[${formatBytes(opt.remoteInfo.size)}]${c.reset}`;
      } else {
        status += ` ${c.red}(offline)${c.reset}`;
      }

      console.log(`     ${status}`);
      console.log(`     ${c.brightBlack}${opt.description}${c.reset}\n`);
    });

    console.log(
      `${c.brightBlack}↑/↓${c.reset} Navigate  ${c.brightBlack}Space${c.reset} Toggle  ${c.brightBlack}Enter${c.reset} Confirm  ${c.brightBlack}Ctrl+C${c.reset} Exit`
    );
  };

  return new Promise((resolve) => {
    // Initial state: select first item if available
    if (options.length > 0 && options[0]) {
      options[0].selected = true;
    }

    process.stdin.setRawMode(true);
    process.stdin.resume();

    render();

    process.stdin.on('data', (key) => {
      const keyStr = key.toString();

      if (keyStr === '\u0003') {
        // Ctrl+C
        process.exit(0);
      } else if (keyStr === '\u001b[A') {
        // Up
        selectedIndex = selectedIndex > 0 ? selectedIndex - 1 : options.length - 1;
        render();
      } else if (keyStr === '\u001b[B') {
        // Down
        selectedIndex = selectedIndex < options.length - 1 ? selectedIndex + 1 : 0;
        render();
      } else if (keyStr === ' ') {
        // Space
        const selectedOption = options[selectedIndex];
        if (selectedOption) {
          selectedOption.selected = !selectedOption.selected;
          render();
        }
      } else if (keyStr === '\r') {
        // Enter
        process.stdin.setRawMode(false);
        process.stdin.pause();
        rl.close();
        resolve(options.filter((o) => o.selected));
      }
    });
  });
}

function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  return 0;
}

export async function runInstaller() {
  printHeader();
  console.log(`${c.cyan}${sym.info} Checking for available databases...${c.reset}\n`);

  // Gather info for all databases
  const choices: OptionalDb[] = [];
  for (const db of AVAILABLE_DBS) {
    console.log(`${c.dim}  Checking ${db.name}...${c.reset}`);
    const localVersion = getLocalVersion(db);
    const remoteInfo = await getRemoteVersion(db);

    // Determine if update is available
    let hasUpdate = false;
    if (localVersion && remoteInfo) {
      hasUpdate = compareVersions(remoteInfo.version, localVersion) > 0;
    }

    choices.push({ ...db, localVersion, remoteInfo, selected: false, hasUpdate });
  }

  // Clear the checking messages
  process.stdout.write((c.cursorUp + c.clearLine).repeat(choices.length + 1));

  if (choices.length === 0) {
    console.log(`${c.yellow}No databases found in configuration.${c.reset}`);
    return;
  }

  // Show summary before selection
  const needsUpdate = choices.filter((c) => c.hasUpdate);
  const notInstalled = choices.filter((c) => !c.localVersion);

  if (needsUpdate.length > 0) {
    console.log(
      `${c.brightYellow}${sym.update}${c.reset} ${c.white}${needsUpdate.length} update(s) available${c.reset}`
    );
  }
  if (notInstalled.length > 0) {
    console.log(
      `${c.cyan}${sym.download}${c.reset} ${c.white}${notInstalled.length} database(s) not installed${c.reset}`
    );
  }
  if (needsUpdate.length === 0 && notInstalled.length === 0) {
    console.log(
      `${c.green}${sym.check}${c.reset} ${c.white}All databases are up to date!${c.reset}`
    );
  }
  console.log();

  // User selection
  const selected = await promptSelection(choices);

  if (selected.length === 0) {
    console.log(`\n${c.yellow}No databases selected. Exiting.${c.reset}`);
    process.stdout.write(c.cursorShow);
    return;
  }

  console.log(`\n${c.brightWhite}Starting installation/update...${c.reset}\n`);

  // Process installation
  let successCount = 0;
  let failCount = 0;

  for (const item of selected) {
    if (!item.remoteInfo) {
      console.log(
        `${c.red}${sym.cross} Skipping ${item.name}: Remote version unavailable.${c.reset}`
      );
      failCount++;
      continue;
    }

    const destDbPath = path.join(CONFIG.dataDir, item.fileName);
    const destManifestPath = path.join(CONFIG.dataDir, item.manifestName);
    const tempDbPath = destDbPath + '.tmp';

    const action = item.localVersion ? 'Updating' : 'Installing';
    const versionInfo = item.localVersion
      ? `${c.brightBlack}v${item.localVersion}${c.reset} ${c.white}→${c.reset} ${c.brightCyan}v${item.remoteInfo.version}${c.reset}`
      : `${c.brightCyan}v${item.remoteInfo.version}${c.reset}`;

    console.log(
      `${c.cyan}${sym.package}${c.reset} ${c.white}${action}${c.reset} ${item.icon} ${c.brightWhite}${item.name}${c.reset} ${c.brightBlack}(${c.reset}${versionInfo}${c.brightBlack})${c.reset}`
    );

    // Ensure data dir exists
    if (!fs.existsSync(CONFIG.dataDir)) {
      fs.mkdirSync(CONFIG.dataDir, { recursive: true });
    }

    try {
      // Download DB to temp file first
      const progress = new ProgressDisplay(`Downloading ${item.fileName}`);
      console.log(); // Space for progress bar

      const download = downloadFileInteractive(item.remoteInfo.downloadUrl, tempDbPath, progress);

      try {
        await download.promise;
        progress.finish(true, 'Download complete!');
      } catch (err) {
        if (err instanceof Error && err.message === 'Download cancelled by user') {
          progress.finish(false, 'Download cancelled');
          // Return to main menu
          console.log(`\n${c.brightBlack}Returning to menu...${c.reset}\n`);
          await new Promise((r) => setTimeout(r, 800));
          return runInstaller();
        }
        throw err;
      }

      // Move temp file to final location (atomic on most systems)
      if (fs.existsSync(destDbPath)) {
        fs.unlinkSync(destDbPath);
      }
      fs.renameSync(tempDbPath, destDbPath);

      // Download Manifest (if available)
      if (item.remoteInfo.manifestUrl) {
        console.log(`${c.dim}   Fetching manifest...${c.reset}`);
        await downloadFile(item.remoteInfo.manifestUrl, destManifestPath);
      } else {
        // Create minimal manifest if missing
        const minimalManifest = {
          version: item.remoteInfo.version,
          updatedAt: new Date().toISOString(),
          source: 'manual-install',
        };
        fs.writeFileSync(destManifestPath, JSON.stringify(minimalManifest, null, 2));
      }

      console.log(
        `${c.brightGreen}${sym.sparkle} Successfully ${item.localVersion ? 'updated' : 'installed'} ${item.name}!${c.reset}\n`
      );
      successCount++;
    } catch (err) {
      // Cleanup temp file if it exists
      if (fs.existsSync(tempDbPath)) {
        fs.unlinkSync(tempDbPath);
      }
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `\n${c.red}${sym.cross} Failed to ${item.localVersion ? 'update' : 'install'} ${item.name}: ${message}${c.reset}\n`
      );
      failCount++;
    }
  }

  // Final summary
  console.log();
  if (successCount > 0 && failCount === 0) {
    console.log(
      `${c.green}${sym.sparkle}${c.reset} ${c.white}All ${successCount} operation(s) completed successfully!${c.reset}`
    );
  } else if (successCount > 0 && failCount > 0) {
    console.log(
      `${c.yellow}${sym.warning}${c.reset} ${c.white}Completed: ${c.green}${successCount} succeeded${c.white}, ${c.red}${failCount} failed${c.reset}`
    );
  } else if (failCount > 0) {
    console.log(`${c.red}${sym.cross}${c.reset} ${c.white}All operations failed${c.reset}`);
  }

  process.stdout.write(c.cursorShow);
}
