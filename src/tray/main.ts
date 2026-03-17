import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron';
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
import { createHttpServer } from '../server/httpServer.js';
import {
  getProjectDirPath,
  loadSeats,
  loadSettings,
  saveSeats,
  saveSettings,
  StandaloneManager,
} from '../server/standaloneManager.js';
import { createWsServer } from '../server/wsServer.js';
import { resolveProjectName } from '../shared/multiProjectScanner.js';
import type { AgentState } from '../types.js';

// ── CLI argument parsing ────────────────────────────────────

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    port: { type: 'string', short: 'p', default: '51898' },
    host: { type: 'string', default: 'localhost' },
    help: { type: 'boolean', default: false },
  },
});

if (values.help) {
  console.log(`
Usage: agent-monitor [options] [project-path]

Options:
  -p, --port <number>     Port to listen on (default: 51898)
  --host <string>         Host to bind to (default: localhost)
  --help                  Show help
`);
  process.exit(0);
}

const port = parseInt(values.port as string, 10);
const host = values.host as string;
const workspacePath = positionals[0] ? path.resolve(positionals[0]) : process.cwd();

// ── Resolve asset and webview directories ────────────────────

// dist/tray.js → dist/
const distDir = path.dirname(__filename);

function findAssetsRoot(): string | null {
  const distAssets = path.join(distDir, 'assets');
  if (fs.existsSync(distAssets)) return distDir;

  const devAssets = path.join(process.cwd(), 'webview-ui', 'public', 'assets');
  if (fs.existsSync(devAssets)) return path.join(process.cwd(), 'webview-ui', 'public');

  return null;
}

function findWebviewDir(): string {
  const distWebview = path.join(distDir, 'webview');
  if (fs.existsSync(distWebview)) return distWebview;

  const devWebview = path.join(process.cwd(), 'dist', 'webview');
  if (fs.existsSync(devWebview)) return devWebview;

  console.error('Could not find webview directory. Run `npm run build:webview` first.');
  process.exit(1);
}

// ── Dock helpers ─────────────────────────────────────────────

let _dockIcon: Electron.NativeImage | null = null;

function showDock(): void {
  app.dock?.show();
  if (_dockIcon) {
    app.dock?.setIcon(_dockIcon);
  }
}

// ── Tray menu building ──────────────────────────────────────

const STATUS_BAR_UPDATE_INTERVAL_MS = 2000;

function buildTrayMenu(
  manager: StandaloneManager,
  mainWindow: BrowserWindow,
  workspaceName: string,
): Menu {
  const items: Electron.MenuItemConstructorOptions[] = [];

  // Group agents by project
  const localAgents = [...manager.agents.values()];
  const crossProjectAgents = [...manager.getCrossProjectAgents().values()];

  // Local project agents
  if (localAgents.length > 0) {
    items.push({ label: `\ud83d\udcc1 ${workspaceName}` });
    for (const agent of localAgents) {
      items.push({ label: `   ${agentStatusLabel(agent)}` });
    }
  }

  // Cross-project agents grouped by projectId
  const byProject = new Map<string, AgentState[]>();
  for (const agent of crossProjectAgents) {
    const key = agent.projectId || 'unknown';
    const list = byProject.get(key) || [];
    list.push(agent);
    byProject.set(key, list);
  }

  for (const [dirName, agents] of byProject) {
    const projectName = resolveProjectName(dirName);
    items.push({ label: `\ud83d\udcc1 ${projectName}` });
    for (const agent of agents) {
      items.push({ label: `   ${agentStatusLabel(agent)}` });
    }
  }

  if (localAgents.length === 0 && crossProjectAgents.length === 0) {
    items.push({ label: '\uc2e4\ud589 \uc911\uc778 \uc5d0\uc774\uc804\ud2b8 \uc5c6\uc74c' });
  }

  items.push(
    { type: 'separator' },
    {
      label: '\uc5f4\uae30',
      click: () => {
        showDock();
        mainWindow.show();
        mainWindow.focus();
      },
    },
    { type: 'separator' },
    {
      label: '\uc885\ub8cc',
      click: () => {
        app.quit();
      },
    },
  );

  return Menu.buildFromTemplate(items);
}

function agentStatusLabel(agent: AgentState): string {
  const name = `\uc5d0\uc774\uc804\ud2b8 #${agent.id}`;
  if (agent.activeToolIds.size > 0) {
    const toolName = agent.activeToolNames.values().next().value || '\uc791\uc5c5 \uc911';
    return `\u25cf ${name} \u2014 ${toolName}`;
  }
  if (agent.isWaiting) {
    return `\u25cb ${name} \u2014 \ub300\uae30 \uc911`;
  }
  return `\u25cb ${name} \u2014 \uc720\ud734`;
}

function trayTitle(manager: StandaloneManager): string {
  const localAgents = [...manager.agents.values()];
  const crossAgents = [...manager.getCrossProjectAgents().values()];
  const total = localAgents.length + crossAgents.length;

  if (total === 0) return '';

  const allAgents = [...localAgents, ...crossAgents];
  let active = 0;
  let waiting = 0;

  for (const a of allAgents) {
    if (a.activeToolIds.size > 0) active++;
    else if (a.isWaiting) waiting++;
  }

  if (waiting > 0) {
    return `${active > 0 ? active : ''}\u00b7${waiting}!`;
  }
  return `${total}`;
}

// ── Main ────────────────────────────────────────────────────

async function main(): Promise<void> {
  app.setName('Agent Monitor');
  await app.whenReady();

  // Resolve dock icon path (bundled to dist/ or fallback to source)
  const dockIconPath = fs.existsSync(path.join(distDir, 'appIcon.png'))
    ? path.join(distDir, 'appIcon.png')
    : path.join(process.cwd(), 'src', 'tray', 'appIcon.png');
  if (fs.existsSync(dockIconPath)) {
    _dockIcon = nativeImage.createFromPath(dockIconPath);
    app.dock?.setIcon(_dockIcon);
  }

  const webviewDir = findWebviewDir();
  const assetsRoot = findAssetsRoot();
  const projectDir = getProjectDirPath(workspacePath);
  const workspaceName = path.basename(workspacePath);

  console.log(`\ud83c\udfae Agent Monitor`);
  console.log(`   Workspace: ${workspacePath}`);
  console.log(`   Project dir: ${projectDir}`);

  // ── Start standalone server ──────────────────────────────
  const wsUrl = `ws://${host}:${port}`;
  const httpServer = createHttpServer(webviewDir, wsUrl, { electron: true });

  let assetsReady = false;
  let charSpritesData: Awaited<ReturnType<typeof loadCharacterSprites>> = null;
  let floorTilesData: Awaited<ReturnType<typeof loadFloorTiles>> = null;
  let wallTilesData: Awaited<ReturnType<typeof loadWallTiles>> = null;
  let furnitureData: Awaited<ReturnType<typeof loadFurnitureAssets>> = null;
  let defaultLayout: Record<string, unknown> | null = null;

  if (assetsRoot) {
    defaultLayout = loadDefaultLayout(assetsRoot);
    charSpritesData = await loadCharacterSprites(assetsRoot);
    floorTilesData = await loadFloorTiles(assetsRoot);
    wallTilesData = await loadWallTiles(assetsRoot);
    furnitureData = await loadFurnitureAssets(assetsRoot);
    assetsReady = true;
    console.log('\u2705 Assets pre-loaded');
  } else {
    console.log('\u26a0\ufe0f  No assets directory found, running without sprites');
    assetsReady = true;
  }

  let layoutWatcher: LayoutWatcher | null = null;

  const noopSink = { postMessage: () => {} };
  const manager = new StandaloneManager(projectDir, workspacePath, noopSink);

  const broadcaster = createWsServer(
    httpServer,
    (ws) => {
      const settings = loadSettings();
      broadcaster.sendTo(ws, { type: 'settingsLoaded', soundEnabled: settings.soundEnabled });

      if (assetsReady) {
        if (charSpritesData) {
          sendCharacterSpritesToWebview(
            { postMessage: (m) => broadcaster.sendTo(ws, m) },
            charSpritesData,
          );
        }
        if (floorTilesData) {
          sendFloorTilesToWebview(
            { postMessage: (m) => broadcaster.sendTo(ws, m) },
            floorTilesData,
          );
        }
        if (wallTilesData) {
          sendWallTilesToWebview({ postMessage: (m) => broadcaster.sendTo(ws, m) }, wallTilesData);
        }
        if (furnitureData) {
          sendAssetsToWebview({ postMessage: (m) => broadcaster.sendTo(ws, m) }, furnitureData);
        }
      }

      const agentIds = manager.getExistingAgentIds();
      const seats = loadSeats();
      broadcaster.sendTo(ws, {
        type: 'existingAgents',
        agents: agentIds,
        agentMeta: seats,
        folderNames: {},
        projectName: workspaceName,
      });

      const layout = readLayoutFromFile() || defaultLayout;
      broadcaster.sendTo(ws, { type: 'layoutLoaded', layout });

      manager.sendCurrentStatuses({ postMessage: (m) => broadcaster.sendTo(ws, m) });
      manager.sendCrossProjectStatuses({ postMessage: (m) => broadcaster.sendTo(ws, m) });

      if (!layoutWatcher) {
        layoutWatcher = watchLayoutFile((changedLayout) => {
          broadcaster.postMessage({ type: 'layoutLoaded', layout: changedLayout });
        });
      }
    },
    (_ws, message) => {
      const type = message.type as string;
      if (type === 'openClaude') {
        manager.spawnAgent();
      } else if (type === 'closeAgent') {
        manager.closeAgent(message.id as number);
      } else if (type === 'focusAgent') {
        // No-op in tray mode
      } else if (type === 'saveAgentSeats') {
        saveSeats(message.seats as Record<string, unknown>);
      } else if (type === 'saveLayout') {
        layoutWatcher?.markOwnWrite();
        writeLayoutToFile(message.layout as Record<string, unknown>);
      } else if (type === 'setSoundEnabled') {
        saveSettings({ soundEnabled: message.enabled as boolean });
      }
    },
  );

  manager.setBroadcast(broadcaster);
  manager.startScanning();
  manager.startCrossProjectScanning();

  await new Promise<void>((resolve) => {
    httpServer.listen(port, host, () => {
      console.log(`\n\ud83c\udf10 Server running at http://${host}:${port}\n`);
      resolve();
    });
  });

  // ── Create BrowserWindow ──────────────────────────────────
  const mainWindow = new BrowserWindow({
    title: 'Agent Monitor',
    width: 1200,
    height: 800,
    show: false,
    titleBarStyle: 'hiddenInset',
    icon: fs.existsSync(dockIconPath) ? dockIconPath : undefined,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(`http://${host}:${port}`);

  // Show window once content is ready
  mainWindow.once('ready-to-show', () => {
    showDock();
    mainWindow.show();
    mainWindow.focus();
  });

  // Close → hide + remove from dock (stay in tray)
  let isQuitting = false;
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
      app.dock?.hide();
    }
  });

  // ── Create Tray ───────────────────────────────────────────
  // Icon is copied to dist/ by esbuild.tray.js; fallback to source for dev
  const distIconPath = path.join(distDir, 'iconTemplate.png');
  const srcIconPath = path.join(process.cwd(), 'src', 'tray', 'iconTemplate.png');
  const resolvedIconPath = fs.existsSync(distIconPath) ? distIconPath : srcIconPath;
  console.log(`   Tray icon: ${resolvedIconPath} (exists: ${fs.existsSync(resolvedIconPath)})`);

  const trayIcon = nativeImage.createFromPath(resolvedIconPath);
  trayIcon.setTemplateImage(true);
  const tray = new Tray(trayIcon);

  // Update tray menu and title periodically
  function updateTray(): void {
    tray.setTitle(trayTitle(manager));
    tray.setContextMenu(buildTrayMenu(manager, mainWindow, workspaceName));
  }

  updateTray();
  const trayTimer = setInterval(updateTray, STATUS_BAR_UPDATE_INTERVAL_MS);

  // ── Graceful shutdown ─────────────────────────────────────
  app.on('before-quit', () => {
    isQuitting = true;
    clearInterval(trayTimer);
    manager.dispose();
    layoutWatcher?.dispose();
    httpServer.close();
  });

  // Don't quit when all windows are closed (stay in tray)
  app.on('window-all-closed', () => {
    // no-op: stay in tray
  });
}

main().catch((err) => {
  console.error('Failed to start Agent Monitor:', err);
  process.exit(1);
});
