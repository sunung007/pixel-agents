import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { parseArgs } from 'util';

import {
  loadCharacterSprites,
  loadDefaultLayout,
  loadFloorTiles,
  loadFurnitureAssets,
  loadWallTiles,
  sendAssetsToWebview,
  sendCharacterSpritesToWebview,
  sendFloorTilesToWebview,
  sendWallTilesToWebview,
} from '../assetLoader.js';
import type { LayoutWatcher } from '../layoutPersistence.js';
import { readLayoutFromFile, watchLayoutFile, writeLayoutToFile } from '../layoutPersistence.js';
import { createHttpServer } from './httpServer.js';
import {
  getProjectDirPath,
  loadSeats,
  loadSettings,
  saveSeats,
  saveSettings,
  StandaloneManager,
} from './standaloneManager.js';
import { createWsServer } from './wsServer.js';

// ── CLI argument parsing ────────────────────────────────────

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    port: { type: 'string', short: 'p', default: '3100' },
    host: { type: 'string', short: 'h', default: 'localhost' },
    'no-open': { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});

if (values.help) {
  console.log(`
Usage: pixel-agents [options] [project-path]

Options:
  -p, --port <number>     Port to listen on (default: 3100)
  -h, --host <string>     Host to bind to (default: localhost)
  --no-open               Don't auto-open browser
  --help                  Show help

Examples:
  pixel-agents                    # Watch current directory
  pixel-agents /path/to/project   # Watch specific project
  pixel-agents -p 8080            # Custom port
`);
  process.exit(0);
}

const port = parseInt(values.port as string, 10);
const host = values.host as string;
const noOpen = values['no-open'] as boolean;
const workspacePath = positionals[0] ? path.resolve(positionals[0]) : process.cwd();

// ── Resolve asset and webview directories ────────────────────

// dist/server.js → dist/
const serverDir = path.dirname(__filename);

function findAssetsRoot(): string | null {
  // When running from dist/server.js, assets are at dist/assets/
  const distAssets = path.join(serverDir, 'assets');
  if (fs.existsSync(distAssets)) return serverDir;

  // Development: webview-ui/public/assets/
  const devAssets = path.join(process.cwd(), 'webview-ui', 'public', 'assets');
  if (fs.existsSync(devAssets)) return path.join(process.cwd(), 'webview-ui', 'public');

  return null;
}

function findWebviewDir(): string {
  // When running from dist/server.js, webview is at dist/webview/
  const distWebview = path.join(serverDir, 'webview');
  if (fs.existsSync(distWebview)) return distWebview;

  // Development fallback
  const devWebview = path.join(process.cwd(), 'dist', 'webview');
  if (fs.existsSync(devWebview)) return devWebview;

  console.error('❌ Could not find webview directory. Run `npm run build:webview` first.');
  process.exit(1);
}

// ── Start server ────────────────────────────────────────────

const webviewDir = findWebviewDir();
const assetsRoot = findAssetsRoot();
const projectDir = getProjectDirPath(workspacePath);

console.log(`🎮 Pixel Agents Server`);
console.log(`   Workspace: ${workspacePath}`);
console.log(`   Project dir: ${projectDir}`);
console.log(`   Assets: ${assetsRoot || '(not found)'}`);

const wsUrl = `ws://${host}:${port}`;
const httpServer = createHttpServer(webviewDir, wsUrl);

// Pre-load assets once at startup
let assetsReady = false;
let charSpritesData: Awaited<ReturnType<typeof loadCharacterSprites>> = null;
let floorTilesData: Awaited<ReturnType<typeof loadFloorTiles>> = null;
let wallTilesData: Awaited<ReturnType<typeof loadWallTiles>> = null;
let furnitureData: Awaited<ReturnType<typeof loadFurnitureAssets>> = null;
let defaultLayout: Record<string, unknown> | null = null;

async function preloadAssets(): Promise<void> {
  if (!assetsRoot) {
    console.log('⚠️  No assets directory found, running without sprites');
    assetsReady = true;
    return;
  }

  defaultLayout = loadDefaultLayout(assetsRoot);
  charSpritesData = await loadCharacterSprites(assetsRoot);
  floorTilesData = await loadFloorTiles(assetsRoot);
  wallTilesData = await loadWallTiles(assetsRoot);
  furnitureData = await loadFurnitureAssets(assetsRoot);
  assetsReady = true;
  console.log('✅ Assets pre-loaded');
}

// Layout watcher for cross-client sync
let layoutWatcher: LayoutWatcher | null = null;

// Create standalone manager (with a temporary no-op broadcaster)
const noopSink = { postMessage: () => {} };
const manager = new StandaloneManager(projectDir, workspacePath, noopSink);

// Create WebSocket server
const broadcaster = createWsServer(
  httpServer,
  // onClientReady
  (ws) => {
    // Send settings
    const settings = loadSettings();
    broadcaster.sendTo(ws, { type: 'settingsLoaded', soundEnabled: settings.soundEnabled });

    // Send assets
    if (assetsReady) {
      if (charSpritesData) {
        sendCharacterSpritesToWebview(
          { postMessage: (m) => broadcaster.sendTo(ws, m) },
          charSpritesData,
        );
      }
      if (floorTilesData) {
        sendFloorTilesToWebview({ postMessage: (m) => broadcaster.sendTo(ws, m) }, floorTilesData);
      }
      if (wallTilesData) {
        sendWallTilesToWebview({ postMessage: (m) => broadcaster.sendTo(ws, m) }, wallTilesData);
      }
      if (furnitureData) {
        sendAssetsToWebview({ postMessage: (m) => broadcaster.sendTo(ws, m) }, furnitureData);
      }
    }

    // Send existing agents BEFORE layout (frontend buffers agents in pendingAgents,
    // then flushes them when layoutLoaded arrives)
    const agentIds = manager.getExistingAgentIds();
    const seats = loadSeats();
    broadcaster.sendTo(ws, {
      type: 'existingAgents',
      agents: agentIds,
      agentMeta: seats,
      folderNames: {},
      projectName: path.basename(workspacePath),
    });

    // Send layout (triggers pendingAgents flush → agents appear)
    const layout = readLayoutFromFile() || defaultLayout;
    broadcaster.sendTo(ws, { type: 'layoutLoaded', layout });

    // Send current agent statuses (local + cross-project)
    manager.sendCurrentStatuses({ postMessage: (m) => broadcaster.sendTo(ws, m) });
    manager.sendCrossProjectStatuses({ postMessage: (m) => broadcaster.sendTo(ws, m) });

    // Start layout watcher if not started
    if (!layoutWatcher) {
      layoutWatcher = watchLayoutFile((changedLayout) => {
        console.log('[Pixel Agents Server] External layout change — pushing to clients');
        broadcaster.postMessage({ type: 'layoutLoaded', layout: changedLayout });
      });
    }
  },
  // onClientMessage
  (_ws, message) => {
    const type = message.type as string;

    if (type === 'openClaude') {
      manager.spawnAgent();
    } else if (type === 'closeAgent') {
      manager.closeAgent(message.id as number);
    } else if (type === 'focusAgent') {
      // No-op in standalone (no terminal to show)
    } else if (type === 'saveAgentSeats') {
      saveSeats(message.seats as Record<string, unknown>);
    } else if (type === 'saveLayout') {
      layoutWatcher?.markOwnWrite();
      writeLayoutToFile(message.layout as Record<string, unknown>);
    } else if (type === 'setSoundEnabled') {
      saveSettings({ soundEnabled: message.enabled as boolean });
    } else if (
      type === 'exportLayout' ||
      type === 'importLayout' ||
      type === 'openSessionsFolder'
    ) {
      // Handled client-side in standalone mode
    }
  },
);

// Point manager's broadcast to the real broadcaster
manager.setBroadcast(broadcaster);

// ── Launch ──────────────────────────────────────────────────

async function main(): Promise<void> {
  await preloadAssets();

  // Start scanning for JSONL files (local project + all projects)
  manager.startScanning();
  manager.startCrossProjectScanning();

  httpServer.listen(port, host, () => {
    const url = `http://${host}:${port}`;
    console.log(`\n🌐 Server running at ${url}\n`);

    if (!noOpen) {
      openBrowser(url);
    }
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    manager.dispose();
    layoutWatcher?.dispose();
    httpServer.close();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    manager.dispose();
    layoutWatcher?.dispose();
    httpServer.close();
    process.exit(0);
  });
}

function openBrowser(url: string): void {
  try {
    const platform = process.platform;
    if (platform === 'darwin') {
      execSync(`open "${url}"`);
    } else if (platform === 'linux') {
      execSync(`xdg-open "${url}"`);
    } else if (platform === 'win32') {
      execSync(`start "" "${url}"`);
    }
  } catch {
    console.log(`Open ${url} in your browser`);
  }
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
