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
  localVersion?: string | null;
  remoteInfo?: RemoteInfo | null;
  selected?: boolean;
}

interface RemoteInfo {
  version: string;
  releaseId: number;
  downloadUrl: string;
  manifestUrl: string | null;
  size: number;
  publishedAt: string;
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

const OPTIONAL_DBS: OptionalDb[] = [
  {
    id: 'mod-examples',
    name: 'Mod Examples Database',
    fileName: 'mod-examples.db',
    manifestName: 'mod-examples-manifest.json',
    description: '1000+ high-quality modding examples for Fabric & NeoForge',
    tagPrefix: 'examples-v',
    icon: '🧩',
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
  onProgress?: (current: number, total: number, speed: number) => void
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
          downloadFile(res.headers.location, destPath, onProgress).then(resolve).catch(reject);
          return;
        }

        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`Download failed with status code ${res.statusCode}`));
        }

        const totalSize = parseInt(res.headers['content-length'] || '0', 10);
        let downloadedSize = 0;
        let startTime = Date.now();

        res.on('data', (chunk: Buffer) => {
          downloadedSize += chunk.length;
          file.write(chunk);

          const currentTime = Date.now();
          const elapsed = (currentTime - startTime) / 1000;
          const speed = elapsed > 0 ? downloadedSize / elapsed : 0;

          if (onProgress) {
            onProgress(downloadedSize, totalSize, speed);
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
      centerText(
        `${c.brightWhite}${c.bold}MCModding-MCP Optional Components${c.reset}`,
        innerWidth
      ) +
      c.brightCyan +
      sym.vertical +
      c.reset
  );
  console.log(
    c.brightCyan +
      sym.vertical +
      c.reset +
      centerText(
        `${c.dim}Enhance your AI assistant with specialized knowledge bases${c.reset}`,
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

function drawProgressBar(current: number, total: number, speed: number, label = 'Downloading') {
  const width = Math.min(getTerminalWidth(), 80);
  const barWidth = Math.max(10, width - 30);

  const percentage = total > 0 ? Math.min(100, (current / total) * 100) : 0;
  const filledWidth = Math.round((percentage / 100) * barWidth);
  const emptyWidth = barWidth - filledWidth;

  const filledBar = c.brightGreen + sym.barFull.repeat(filledWidth) + c.reset;
  const emptyBar = c.dim + sym.barEmpty.repeat(emptyWidth) + c.reset;

  process.stdout.write(c.cursorHide);
  process.stdout.write(c.clearLine + '\r');

  const sizeStr = `${formatBytes(current)}/${formatBytes(total)}`;
  const speedStr = formatSpeed(speed);

  console.log(c.cursorUp + c.clearLine + `${c.cyan}${sym.download} ${label}...${c.reset}`);
  console.log(`${filledBar}${emptyBar} ${c.brightWhite}${percentage.toFixed(1)}%${c.reset}`);
  console.log(`${c.dim}${sizeStr} • ${speedStr}${c.reset}`);
  process.stdout.write(c.cursorUp + c.cursorUp);
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
    const version = release.tag_name.replace(dbConfig.tagPrefix, '');

    // Find assets
    const dbAsset = release.assets.find((a) => a.name === dbConfig.fileName);
    const manifestAsset = release.assets.find((a) => a.name === dbConfig.manifestName);

    if (!dbAsset) return null;

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
    console.log(`${c.brightWhite}Select a database to install/update:${c.reset}\n`);

    options.forEach((opt, idx) => {
      const isSelected = idx === selectedIndex;
      const prefix = isSelected ? `${c.brightCyan}${sym.arrowRight} ` : '  ';
      const checkbox = opt.selected
        ? `${c.brightGreen}${sym.selected}${c.reset}`
        : `${c.dim}${sym.unselected}${c.reset}`;
      const style = isSelected ? c.brightWhite + c.bold : c.white;

      console.log(`${prefix}${checkbox} ${style}${opt.name}${c.reset}`);

      // Status line
      let status = '';
      if (opt.localVersion) {
        status += `${c.green}Installed: v${opt.localVersion}${c.reset}`;
      } else {
        status += `${c.dim}Not installed${c.reset}`;
      }

      if (opt.remoteInfo) {
        if (opt.localVersion && opt.remoteInfo.version !== opt.localVersion) {
          status += ` ${c.dim}→${c.reset} ${c.brightYellow}Update available: v${opt.remoteInfo.version}${c.reset}`;
        } else if (!opt.localVersion) {
          status += ` ${c.dim}→${c.reset} ${c.brightCyan}Available: v${opt.remoteInfo.version}${c.reset}`;
        } else {
          status += ` ${c.dim}(Latest)${c.reset}`;
        }
        status += ` ${c.dim}[${formatBytes(opt.remoteInfo.size)}]${c.reset}`;
      } else {
        status += ` ${c.red}(Offline/Unavailable)${c.reset}`;
      }

      console.log(`     ${status}`);
      console.log(`     ${c.dim}${opt.description}${c.reset}\n`);
    });

    console.log(`${c.dim}Use ↑/↓ to navigate, SPACE to toggle, ENTER to confirm${c.reset}`);
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

export async function runInstaller() {
  printHeader();
  console.log(`${c.cyan}${sym.info} Checking for available databases...${c.reset}`);

  // Gather info
  const choices: OptionalDb[] = [];
  for (const db of OPTIONAL_DBS) {
    const localVersion = getLocalVersion(db);
    const remoteInfo = await getRemoteVersion(db);
    choices.push({ ...db, localVersion, remoteInfo, selected: false });
  }

  if (choices.length === 0) {
    console.log(`${c.yellow}No optional databases found in configuration.${c.reset}`);
    return;
  }

  // User selection
  const selected = await promptSelection(choices);

  if (selected.length === 0) {
    console.log(`\n${c.yellow}No databases selected. Exiting.${c.reset}`);
    return;
  }

  console.log(`\n${c.brightWhite}Starting installation...${c.reset}\n`);

  // Process installation
  for (const item of selected) {
    if (!item.remoteInfo) {
      console.log(
        `${c.red}${sym.cross} Skipping ${item.name}: Remote version unavailable.${c.reset}`
      );
      continue;
    }

    const destDbPath = path.join(CONFIG.dataDir, item.fileName);
    const destManifestPath = path.join(CONFIG.dataDir, item.manifestName);

    console.log(
      `${c.brightCyan}${sym.package} Installing ${item.name} (v${item.remoteInfo.version})...${c.reset}`
    );

    // Ensure data dir exists
    if (!fs.existsSync(CONFIG.dataDir)) {
      fs.mkdirSync(CONFIG.dataDir, { recursive: true });
    }

    try {
      // Download DB
      console.log(); // Space for progress bar
      await downloadFile(item.remoteInfo.downloadUrl, destDbPath, (current, total, speed) => {
        drawProgressBar(current, total, speed, `Downloading ${item.fileName}`);
      });
      console.log(`\n${c.green}${sym.check} Download complete!${c.reset}`);

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
        `${c.brightGreen}${sym.sparkle} Successfully installed ${item.name}!${c.reset}\n`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `\n${c.red}${sym.cross} Failed to install ${item.name}: ${message}${c.reset}\n`
      );
    }
  }

  console.log(`${c.brightWhite}${sym.check} All operations completed.${c.reset}`);
}
