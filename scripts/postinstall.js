#!/usr/bin/env node
/* eslint-disable no-undef, no-control-regex, no-unused-vars */

/**
 * MCModding-MCP Postinstall Script
 * Downloads the documentation database during npm installation
 * with a stunning visual CLI experience
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import https from 'https';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

const CONFIG = {
  repoUrl: 'https://api.github.com/repos/OGMatrix/mcmodding-mcp/releases',
  dataDir: path.join(__dirname, '..', 'data'),
  dbFileName: 'mcmodding-docs.db',
  manifestFileName: 'db-manifest.json',
  userAgent: 'mcmodding-mcp-installer',
};

// ═══════════════════════════════════════════════════════════════════════════════
// ANSI COLORS & STYLES
// ═══════════════════════════════════════════════════════════════════════════════

const isColorSupported = process.stdout.isTTY && !process.env.NO_COLOR;

const c = {
  // Reset
  reset: isColorSupported ? '\x1b[0m' : '',
  // Styles
  bold: isColorSupported ? '\x1b[1m' : '',
  dim: isColorSupported ? '\x1b[2m' : '',
  italic: isColorSupported ? '\x1b[3m' : '',
  underline: isColorSupported ? '\x1b[4m' : '',
  // Colors
  black: isColorSupported ? '\x1b[30m' : '',
  red: isColorSupported ? '\x1b[31m' : '',
  green: isColorSupported ? '\x1b[32m' : '',
  yellow: isColorSupported ? '\x1b[33m' : '',
  blue: isColorSupported ? '\x1b[34m' : '',
  magenta: isColorSupported ? '\x1b[35m' : '',
  cyan: isColorSupported ? '\x1b[36m' : '',
  white: isColorSupported ? '\x1b[37m' : '',
  // Bright colors
  brightBlack: isColorSupported ? '\x1b[90m' : '',
  brightRed: isColorSupported ? '\x1b[91m' : '',
  brightGreen: isColorSupported ? '\x1b[92m' : '',
  brightYellow: isColorSupported ? '\x1b[93m' : '',
  brightBlue: isColorSupported ? '\x1b[94m' : '',
  brightMagenta: isColorSupported ? '\x1b[95m' : '',
  brightCyan: isColorSupported ? '\x1b[96m' : '',
  brightWhite: isColorSupported ? '\x1b[97m' : '',
  // Backgrounds
  bgBlack: isColorSupported ? '\x1b[40m' : '',
  bgRed: isColorSupported ? '\x1b[41m' : '',
  bgGreen: isColorSupported ? '\x1b[42m' : '',
  bgYellow: isColorSupported ? '\x1b[43m' : '',
  bgBlue: isColorSupported ? '\x1b[44m' : '',
  bgMagenta: isColorSupported ? '\x1b[45m' : '',
  bgCyan: isColorSupported ? '\x1b[46m' : '',
  bgWhite: isColorSupported ? '\x1b[47m' : '',
  // Cursor
  clearLine: isColorSupported ? '\x1b[2K' : '',
  cursorUp: isColorSupported ? '\x1b[1A' : '',
  cursorHide: isColorSupported ? '\x1b[?25l' : '',
  cursorShow: isColorSupported ? '\x1b[?25h' : '',
};

// ═══════════════════════════════════════════════════════════════════════════════
// UNICODE SYMBOLS & BOX DRAWING
// ═══════════════════════════════════════════════════════════════════════════════

const sym = {
  // Box drawing (double line)
  topLeft: '╔',
  topRight: '╗',
  bottomLeft: '╚',
  bottomRight: '╝',
  horizontal: '═',
  vertical: '║',
  // Box drawing (single line)
  sTopLeft: '┌',
  sTopRight: '┐',
  sBottomLeft: '└',
  sBottomRight: '┘',
  sHorizontal: '─',
  sVertical: '│',
  // Progress bar
  barFull: '█',
  barThreeQuarter: '▓',
  barHalf: '▒',
  barQuarter: '░',
  barEmpty: '░',
  // Status symbols
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
  cube: '◆',
  arrow: '→',
  arrowRight: '▶',
  dot: '●',
  circle: '○',
  diamond: '◇',
  // Minecraft themed
  pickaxe: '⛏',
  gear: '⚙',
  book: '📖',
};

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

function getTerminalWidth() {
  return process.stdout.columns || 80;
}

function centerText(text, width) {
  const cleanText = text.replace(/\x1b\[[0-9;]*m/g, '');
  const totalPadding = Math.max(0, width - cleanText.length);
  const leftPadding = Math.floor(totalPadding / 2);
  const rightPadding = totalPadding - leftPadding;
  return ' '.repeat(leftPadding) + text + ' '.repeat(rightPadding);
}

function padRight(text, width) {
  const cleanText = text.replace(/\x1b\[[0-9;]*m/g, '');
  const padding = Math.max(0, width - cleanText.length);
  return text + ' '.repeat(padding);
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatSpeed(bytesPerSecond) {
  return formatBytes(bytesPerSecond) + '/s';
}

function formatTime(seconds) {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m ${secs}s`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════════════════════════════════════════════
// VISUAL COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

function printBanner() {
  const width = Math.min(getTerminalWidth(), 72);
  const innerWidth = width - 2;

  console.log();
  console.log(
    c.brightCyan + sym.topLeft + sym.horizontal.repeat(width - 2) + sym.topRight + c.reset
  );

  // ASCII Art Logo
  const logo = [
    `${c.brightGreen}    __  __  ___   __  __           _     _ _             ${c.reset}`,
    `${c.brightGreen}   |  \\/  |/ __| |  \\/  | ___   __| | __| (_)_ __   __ _ ${c.reset}`,
    `${c.brightGreen}   | |\\/| | |    | |\\/| |/ _ \\ / _\` |/ _\` | | '_ \\ / _\` |${c.reset}`,
    `${c.brightGreen}   | |  | | |___ | |  | | (_) | (_| | (_| | | | | | (_| |${c.reset}`,
    `${c.brightGreen}   |_|  |_|\\____||_|  |_|\\___/ \\__,_|\\__,_|_|_| |_|\\__, |${c.reset}`,
    `${c.brightGreen}                                                   |___/ ${c.reset}`,
  ];

  logo.forEach((line) => {
    console.log(
      c.brightCyan +
        sym.vertical +
        c.reset +
        centerText(line, innerWidth) +
        c.brightCyan +
        sym.vertical +
        c.reset
    );
  });

  // Subtitle
  console.log(c.brightCyan + sym.vertical + ' '.repeat(innerWidth) + sym.vertical + c.reset);
  const subtitle = `${c.brightMagenta}${sym.pickaxe} ${c.bold}Minecraft Modding Documentation${c.reset}${c.brightMagenta} ${sym.pickaxe}${c.reset}`;
  console.log(
    c.brightCyan +
      sym.vertical +
      c.reset +
      centerText(subtitle, innerWidth) +
      c.brightCyan +
      sym.vertical +
      c.reset
  );

  const subtitle2 = `${c.dim}Model Context Protocol Server${c.reset}`;
  console.log(
    c.brightCyan +
      sym.vertical +
      c.reset +
      centerText(subtitle2, innerWidth) +
      c.brightCyan +
      sym.vertical +
      c.reset
  );

  console.log(
    c.brightCyan + sym.bottomLeft + sym.horizontal.repeat(width - 2) + sym.bottomRight + c.reset
  );
  console.log();
}

function printSectionHeader(title, icon = sym.arrowRight) {
  const width = Math.min(getTerminalWidth(), 72);
  console.log();
  console.log(
    c.brightBlue +
      sym.sTopLeft +
      sym.sHorizontal.repeat(2) +
      c.reset +
      ` ${c.bold}${icon} ${title}${c.reset} ` +
      c.brightBlue +
      sym.sHorizontal.repeat(Math.max(0, width - title.length - 10)) +
      sym.sTopRight +
      c.reset
  );
}

function printSectionFooter() {
  const width = Math.min(getTerminalWidth(), 72);
  console.log(
    c.brightBlue + sym.sBottomLeft + sym.sHorizontal.repeat(width - 2) + sym.sBottomRight + c.reset
  );
}

function createProgressBar(progress, width = 40, showGradient = true) {
  const clampedProgress = Math.min(Math.max(progress, 0), 1);
  const filled = Math.round(clampedProgress * width);
  const empty = Math.max(0, width - filled);

  let bar = '';
  if (showGradient && isColorSupported) {
    // Gradient effect from green to cyan
    for (let i = 0; i < filled; i++) {
      const ratio = i / width;
      if (ratio < 0.33) bar += c.green + sym.barFull;
      else if (ratio < 0.66) bar += c.brightGreen + sym.barFull;
      else bar += c.brightCyan + sym.barFull;
    }
    bar += c.reset;
  } else {
    bar = c.brightGreen + sym.barFull.repeat(filled) + c.reset;
  }

  bar += c.dim + sym.barEmpty.repeat(empty) + c.reset;
  return bar;
}

class ProgressDisplay {
  constructor() {
    this.lines = 0;
    this.startTime = Date.now();
    this.lastUpdate = 0;
    this.speeds = [];
  }

  clear() {
    if (isColorSupported && this.lines > 0) {
      // Move cursor up and clear all lines in a single write operation
      const clearSequence = (c.cursorUp + c.clearLine).repeat(this.lines);
      process.stdout.write(clearSequence);
    }
    this.lines = 0;
  }

  calculateSpeed(downloaded, elapsed) {
    if (elapsed === 0) return 0;
    const currentSpeed = downloaded / elapsed;
    this.speeds.push(currentSpeed);
    if (this.speeds.length > 5) this.speeds.shift();
    return this.speeds.reduce((a, b) => a + b, 0) / this.speeds.length;
  }

  update(downloaded, total, phase = 'download') {
    const now = Date.now();
    if (now - this.lastUpdate < 100) return; // Throttle updates
    this.lastUpdate = now;

    this.clear();

    const width = Math.min(getTerminalWidth(), 72);
    const barWidth = Math.max(20, width - 35);
    const progress = total > 0 ? downloaded / total : 0;
    const percent = Math.round(progress * 100);
    const elapsed = (now - this.startTime) / 1000;
    const speed = this.calculateSpeed(downloaded, elapsed);
    const eta = speed > 0 ? (total - downloaded) / speed : 0;

    const lines = [];

    // Status line with icon
    const statusIcon = phase === 'download' ? sym.download : sym.shield;
    const statusText = phase === 'download' ? 'Downloading database...' : 'Verifying integrity...';
    lines.push(`  ${c.brightYellow}${statusIcon}${c.reset} ${c.bold}${statusText}${c.reset}`);

    // Progress bar
    const bar = createProgressBar(progress, barWidth);
    const percentStr = `${percent}%`.padStart(4);
    lines.push(
      `  ${c.dim}[${c.reset}${bar}${c.dim}]${c.reset} ${c.brightWhite}${percentStr}${c.reset}`
    );

    // Stats line
    const downloadedStr = formatBytes(downloaded);
    const totalStr = formatBytes(total);
    const speedStr = phase === 'download' ? formatSpeed(speed) : '';
    const etaStr = phase === 'download' && eta > 0 ? `ETA: ${formatTime(eta)}` : '';

    let statsLine = `  ${c.dim}${sym.cube}${c.reset} ${c.cyan}${downloadedStr}${c.reset} ${c.dim}/${c.reset} ${c.cyan}${totalStr}${c.reset}`;
    if (speedStr)
      statsLine += `  ${c.dim}${sym.lightning}${c.reset} ${c.brightMagenta}${speedStr}${c.reset}`;
    if (etaStr) statsLine += `  ${c.dim}${sym.clock}${c.reset} ${c.yellow}${etaStr}${c.reset}`;

    lines.push(statsLine);

    // Print all lines as a single write operation to prevent flickering
    this.lines = lines.length;
    process.stdout.write(lines.join('\n') + '\n');
  }

  finish(success = true, message = '') {
    this.clear();
    const icon = success ? c.brightGreen + sym.check : c.brightRed + sym.cross;
    const color = success ? c.brightGreen : c.brightRed;
    console.log(`  ${icon}${c.reset} ${color}${message}${c.reset}`);
    this.lines = 1;
  }
}

function printStepIndicator(step, total, description, status = 'pending') {
  const icons = {
    pending: c.dim + sym.circle + c.reset,
    active: c.brightYellow + sym.dot + c.reset,
    done: c.brightGreen + sym.check + c.reset,
    error: c.brightRed + sym.cross + c.reset,
  };

  const colors = {
    pending: c.dim,
    active: c.brightWhite,
    done: c.green,
    error: c.red,
  };

  console.log(
    `  ${icons[status]} ${colors[status]}Step ${step}/${total}: ${description}${c.reset}`
  );
}

function printWelcomeScreen() {
  const width = Math.min(getTerminalWidth(), 72);
  const innerWidth = width - 4;

  console.log();
  console.log(
    c.brightGreen + '  ' + sym.sparkle + ' Installation Complete! ' + sym.sparkle + c.reset
  );
  console.log();

  // Welcome box
  console.log(
    c.green + '  ' + sym.topLeft + sym.horizontal.repeat(width - 4) + sym.topRight + c.reset
  );

  const welcomeLines = [
    '',
    `${c.bold}${c.brightWhite}Welcome to MCModding-MCP!${c.reset}`,
    '',
    `${c.dim}Your AI assistant now has access to comprehensive${c.reset}`,
    `${c.dim}Minecraft modding documentation for:${c.reset}`,
    '',
    `  ${c.brightGreen}${sym.check}${c.reset} ${c.cyan}Fabric${c.reset} - Lightweight modding toolchain`,
    `  ${c.brightGreen}${sym.check}${c.reset} ${c.magenta}NeoForge${c.reset} - Community-driven mod loader`,
    '',
  ];

  welcomeLines.forEach((line) => {
    const paddedLine = centerText(line, innerWidth);
    console.log(
      c.green + '  ' + sym.vertical + c.reset + paddedLine + c.green + sym.vertical + c.reset
    );
  });

  console.log(
    c.green + '  ' + sym.bottomLeft + sym.horizontal.repeat(width - 4) + sym.bottomRight + c.reset
  );
  console.log();

  // Quick start section
  console.log(
    c.brightBlue +
      '  ' +
      sym.sTopLeft +
      sym.sHorizontal.repeat(2) +
      c.reset +
      ` ${c.bold}${sym.rocket} Quick Start${c.reset} ` +
      c.brightBlue +
      sym.sHorizontal.repeat(width - 20) +
      sym.sTopRight +
      c.reset
  );
  console.log(c.brightBlue + '  ' + sym.sVertical + c.reset);

  const quickStart = [
    [`${c.yellow}Configure Claude Desktop:${c.reset}`, ''],
    [
      `${c.dim}Add to your ${c.reset}${c.cyan}claude_desktop_config.json${c.reset}${c.dim}:${c.reset}`,
      '',
    ],
    ['', ''],
    [`  ${c.brightBlack}{${c.reset}`, ''],
    [`    ${c.brightBlue}"mcpServers"${c.reset}: {`, ''],
    [`      ${c.brightGreen}"mcmodding"${c.reset}: {`, ''],
    [`        ${c.brightMagenta}"command"${c.reset}: ${c.yellow}"npx"${c.reset},`, ''],
    [`        ${c.brightMagenta}"args"${c.reset}: [${c.yellow}"mcmodding-mcp"${c.reset}]`, ''],
    [`      }`, ''],
    [`    }`, ''],
    [`  ${c.brightBlack}}${c.reset}`, ''],
  ];

  quickStart.forEach(([line]) => {
    console.log(c.brightBlue + '  ' + sym.sVertical + c.reset + '  ' + line);
  });

  console.log(c.brightBlue + '  ' + sym.sVertical + c.reset);
  console.log(
    c.brightBlue +
      '  ' +
      sym.sBottomLeft +
      sym.sHorizontal.repeat(width - 4) +
      sym.sBottomRight +
      c.reset
  );
  console.log();

  // Available tools section
  console.log(
    c.brightMagenta +
      '  ' +
      sym.sTopLeft +
      sym.sHorizontal.repeat(2) +
      c.reset +
      ` ${c.bold}${sym.gear} Available Tools${c.reset} ` +
      c.brightMagenta +
      sym.sHorizontal.repeat(width - 24) +
      sym.sTopRight +
      c.reset
  );
  console.log(c.brightMagenta + '  ' + sym.sVertical + c.reset);

  const tools = [
    [`${c.brightCyan}search_docs${c.reset}`, 'Search documentation with semantic understanding'],
    [`${c.brightCyan}get_document${c.reset}`, 'Retrieve full documentation pages'],
    [`${c.brightCyan}list_categories${c.reset}`, 'Browse available documentation categories'],
    [`${c.brightCyan}get_code_examples${c.reset}`, 'Find relevant code snippets and examples'],
  ];

  tools.forEach(([name, desc]) => {
    console.log(c.brightMagenta + '  ' + sym.sVertical + c.reset + `  ${sym.arrowRight} ${name}`);
    console.log(c.brightMagenta + '  ' + sym.sVertical + c.reset + `    ${c.dim}${desc}${c.reset}`);
  });

  console.log(c.brightMagenta + '  ' + sym.sVertical + c.reset);
  console.log(
    c.brightMagenta +
      '  ' +
      sym.sBottomLeft +
      sym.sHorizontal.repeat(width - 4) +
      sym.sBottomRight +
      c.reset
  );
  console.log();

  // Footer links
  console.log(c.dim + '  ' + sym.sHorizontal.repeat(width - 4) + c.reset);
  console.log();
  console.log(
    `  ${c.dim}${sym.book}${c.reset} ${c.brightBlue}GitHub:${c.reset} ${c.underline}https://github.com/OGMatrix/mcmodding-mcp${c.reset}`
  );
  console.log(
    `  ${c.dim}${sym.warning}${c.reset} ${c.brightBlue}Issues:${c.reset} ${c.underline}https://github.com/OGMatrix/mcmodding-mcp/issues${c.reset}`
  );
  console.log();
  console.log(c.dim + '  ' + sym.sHorizontal.repeat(width - 4) + c.reset);
  console.log();
  console.log(
    `  ${c.brightGreen}${sym.sparkle}${c.reset} ${c.italic}Happy modding!${c.reset} ${c.brightGreen}${sym.sparkle}${c.reset}`
  );
  console.log();
}

// ═══════════════════════════════════════════════════════════════════════════════
// NETWORK FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

function httpsGet(url, options = {}) {
  return new Promise((resolve, reject) => {
    const headers = {
      'User-Agent': CONFIG.userAgent,
      Accept: 'application/vnd.github.v3+json',
      ...options.headers,
    };

    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }

    const req = https.get(
      url,
      {
        headers,
      },
      (res) => {
        // Handle redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          httpsGet(res.headers.location, options).then(resolve).catch(reject);
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
          return;
        }

        if (options.stream) {
          resolve(res);
          return;
        }

        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve(data));
        res.on('error', reject);
      }
    );

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

async function downloadWithProgress(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);

    console.log(`  ${c.dim}${sym.arrow} Downloading from: ${url}${c.reset}`);

    const makeRequest = (requestUrl) => {
      const urlObj = new URL(requestUrl);
      const headers = {
        'User-Agent': CONFIG.userAgent,
      };

      if (process.env.GITHUB_TOKEN) {
        headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
      }

      const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        headers,
      };

      https
        .get(options, (res) => {
          // Handle redirects
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            makeRequest(res.headers.location);
            return;
          }

          if (res.statusCode !== 200) {
            file.close();
            fs.unlinkSync(destPath);
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }

          const total = parseInt(res.headers['content-length'], 10) || 0;
          let downloaded = 0;

          res.on('data', (chunk) => {
            downloaded += chunk.length;
            file.write(chunk);
            if (onProgress) onProgress(downloaded, total);
          });

          res.on('end', () => {
            file.end();
            resolve({ downloaded, total });
          });

          res.on('error', (err) => {
            file.close();
            fs.unlinkSync(destPath);
            reject(err);
          });
        })
        .on('error', (err) => {
          file.close();
          if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
          reject(err);
        });
    };

    makeRequest(url);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN INSTALLATION LOGIC
// ═══════════════════════════════════════════════════════════════════════════════

async function fetchReleaseInfo() {
  const response = await httpsGet(CONFIG.repoUrl);
  const releases = JSON.parse(response);

  // Find the first release that has the required assets
  for (const release of releases) {
    const hasManifest = release.assets.some((a) => a.name === 'db-manifest.json');
    const hasDb = release.assets.some((a) => a.name === 'mcmodding-docs.db');

    if (hasManifest && hasDb) {
      return release;
    }
  }

  throw new Error('No suitable release found with database artifacts');
}

async function fetchManifest(manifestUrl) {
  const response = await httpsGet(manifestUrl);
  return JSON.parse(response);
}

async function calculateFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function verifyWithProgress(filePath, expectedHash, progress) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stats = fs.statSync(filePath);
    const total = stats.size;
    let processed = 0;

    const stream = fs.createReadStream(filePath);

    stream.on('data', (chunk) => {
      hash.update(chunk);
      processed += chunk.length;
      progress.update(processed, total, 'verify');
    });

    stream.on('end', () => {
      const actualHash = hash.digest('hex');
      resolve(actualHash === expectedHash);
    });

    stream.on('error', reject);
  });
}

async function main() {
  // Hide cursor during installation
  if (isColorSupported) process.stdout.write(c.cursorHide);

  // Ensure cursor is shown on exit
  const cleanup = () => {
    if (isColorSupported) process.stdout.write(c.cursorShow);
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => {
    cleanup();
    process.exit(1);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(1);
  });

  try {
    printBanner();

    printSectionHeader('Installation Progress', sym.package);
    console.log();

    // Step 1: Check for existing database
    printStepIndicator(1, 4, 'Checking existing installation...', 'active');
    await sleep(300);

    const dbPath = path.join(CONFIG.dataDir, CONFIG.dbFileName);
    const manifestPath = path.join(CONFIG.dataDir, CONFIG.manifestFileName);

    if (fs.existsSync(dbPath) && fs.existsSync(manifestPath)) {
      process.stdout.write(c.cursorUp + c.clearLine);
      printStepIndicator(1, 4, 'Existing database found - skipping download', 'done');
      console.log();
      printSectionFooter();
      printWelcomeScreen();
      return;
    }

    process.stdout.write(c.cursorUp + c.clearLine);
    printStepIndicator(1, 4, 'No existing database - will download', 'done');

    // Step 2: Fetch release information
    printStepIndicator(2, 4, 'Fetching latest release information...', 'active');

    let release, manifest;
    try {
      release = await fetchReleaseInfo();
      const manifestAsset = release.assets.find((a) => a.name === 'db-manifest.json');
      if (!manifestAsset) throw new Error('No manifest found in release');

      manifest = await fetchManifest(manifestAsset.browser_download_url);

      // Find the database asset in the release to ensure we have the correct download URL
      // This overrides the URL in the manifest which might be outdated or incorrect
      const dbAsset = release.assets.find((a) => a.name === CONFIG.dbFileName);
      if (dbAsset) {
        manifest.downloadUrl = dbAsset.browser_download_url;
      }
    } catch (error) {
      process.stdout.write(c.cursorUp + c.clearLine);
      printStepIndicator(2, 4, `Failed to fetch release info: ${error.message}`, 'error');
      console.log();
      console.log(
        c.yellow + `  ${sym.warning} The database will be downloaded on first use.${c.reset}`
      );
      printSectionFooter();
      printWelcomeScreen();
      return;
    }

    process.stdout.write(c.cursorUp + c.clearLine);
    printStepIndicator(
      2,
      4,
      `Found database v${manifest.version} (${formatBytes(manifest.size)})`,
      'done'
    );

    // Step 3: Download database
    printStepIndicator(3, 4, 'Downloading database...', 'active');
    console.log();

    // Ensure data directory exists
    if (!fs.existsSync(CONFIG.dataDir)) {
      fs.mkdirSync(CONFIG.dataDir, { recursive: true });
    }

    const tempPath = dbPath + '.tmp';
    const progress = new ProgressDisplay();

    try {
      await downloadWithProgress(manifest.downloadUrl, tempPath, (downloaded, total) => {
        progress.update(downloaded, total || manifest.size, 'download');
      });
      progress.finish(true, 'Download complete!');
    } catch (error) {
      console.error(error);
      progress.finish(false, `Download failed: ${error.message}`);
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      console.log();
      console.log(
        c.yellow + `  ${sym.warning} The database will be downloaded on first use.${c.reset}`
      );
      printSectionFooter();
      printWelcomeScreen();
      return;
    }

    // Clear the step indicator and update
    process.stdout.write(c.cursorUp + c.cursorUp + c.clearLine);
    printStepIndicator(3, 4, 'Database downloaded successfully', 'done');
    process.stdout.write(c.cursorUp + c.clearLine);
    process.stdout.write('\n'); // Move past the progress line

    // Step 4: Verify integrity
    printStepIndicator(4, 4, 'Verifying file integrity...', 'active');
    console.log();

    const verifyProgress = new ProgressDisplay();

    try {
      const isValid = await verifyWithProgress(tempPath, manifest.hash, verifyProgress);

      if (!isValid) {
        verifyProgress.finish(false, 'Hash verification failed!');
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        console.log();
        console.log(
          c.yellow + `  ${sym.warning} The database will be downloaded on first use.${c.reset}`
        );
        printSectionFooter();
        printWelcomeScreen();
        return;
      }

      verifyProgress.finish(true, 'Integrity verified!');

      // Move temp file to final location
      fs.renameSync(tempPath, dbPath);

      // Save manifest
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    } catch (error) {
      verifyProgress.finish(false, `Verification failed: ${error.message}`);
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      console.log();
      console.log(
        c.yellow + `  ${sym.warning} The database will be downloaded on first use.${c.reset}`
      );
      printSectionFooter();
      printWelcomeScreen();
      return;
    }

    // Clear and update final step
    process.stdout.write(c.cursorUp + c.cursorUp + c.clearLine);
    printStepIndicator(4, 4, 'Database verified and installed', 'done');
    console.log();

    printSectionFooter();

    // Show welcome screen
    printWelcomeScreen();
  } catch (error) {
    console.error();
    console.error(c.brightRed + `  ${sym.cross} Installation error: ${error.message}${c.reset}`);
    console.error();
    console.log(
      c.yellow + `  ${sym.warning} The database will be downloaded on first use.${c.reset}`
    );
    console.log();
    printWelcomeScreen();
  } finally {
    cleanup();
  }
}

// Run the installer
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(0); // Don't fail npm install
});
