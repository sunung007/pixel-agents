import type { ChildProcess } from 'child_process';
import { execSync, spawn } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  ACTIVE_SESSION_MAX_AGE_MS,
  CROSS_PROJECT_SCAN_INTERVAL_MS,
  FILE_WATCHER_POLL_INTERVAL_MS,
  PROJECT_SCAN_INTERVAL_MS,
} from '../constants.js';
import type { MessageSink } from '../shared/messageSink.js';
import type { ProjectInfo } from '../shared/multiProjectScanner.js';
import {
  generateCrossProjectAgentId,
  getActiveJsonlFiles,
  getAllProjectDirs,
  resolveProjectName,
} from '../shared/multiProjectScanner.js';
import { cancelPermissionTimer, cancelWaitingTimer, clearAgentActivity } from '../timerManager.js';
import { processTranscriptLine } from '../transcriptParser.js';
import type { AgentState, TerminalHandle } from '../types.js';
import { createDefaultUsage } from '../types.js';

// ── Settings persistence ────────────────────────────────────

const SETTINGS_DIR = path.join(os.homedir(), '.pixel-agents');
const SEATS_FILE = path.join(SETTINGS_DIR, 'seats.json');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'settings.json');

function ensureSettingsDir(): void {
  if (!fs.existsSync(SETTINGS_DIR)) {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  }
}

export function loadSeats(): Record<string, { palette?: number; seatId?: string }> {
  try {
    if (fs.existsSync(SEATS_FILE)) {
      return JSON.parse(fs.readFileSync(SEATS_FILE, 'utf-8'));
    }
  } catch {
    /* ignore */
  }
  return {};
}

export function saveSeats(seats: Record<string, unknown>): void {
  ensureSettingsDir();
  fs.writeFileSync(SEATS_FILE, JSON.stringify(seats, null, 2), 'utf-8');
}

export function loadSettings(): { soundEnabled: boolean } {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
    }
  } catch {
    /* ignore */
  }
  return { soundEnabled: true };
}

export function saveSettings(settings: { soundEnabled: boolean }): void {
  ensureSettingsDir();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
}

// ── Project dir path ─────────────────────────────────────────

export function getProjectDirPath(workspacePath: string): string {
  // Claude Code uses the git root path (not cwd) for the project hash
  let resolvedPath = workspacePath;
  try {
    const gitRoot = execSync('git rev-parse --show-toplevel', {
      cwd: workspacePath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (gitRoot) {
      resolvedPath = gitRoot;
    }
  } catch {
    // Not a git repo — use the provided path as-is
  }
  const dirName = resolvedPath.replace(/[^a-zA-Z0-9-]/g, '-');
  return path.join(os.homedir(), '.claude', 'projects', dirName);
}

// ── Process-backed TerminalHandle ────────────────────────────

class ProcessTerminalHandle implements TerminalHandle {
  readonly name: string;
  constructor(
    name: string,
    private readonly proc: ChildProcess,
  ) {
    this.name = name;
  }
  show(): void {
    /* no-op in standalone */
  }
  dispose(): void {
    if (!this.proc.killed) {
      this.proc.kill('SIGTERM');
    }
  }
}

// ── Standalone Manager ───────────────────────────────────────

export class StandaloneManager {
  private nextAgentId = { current: 1 };
  readonly agents = new Map<number, AgentState>();
  private fileWatchers = new Map<number, fs.FSWatcher>();
  private pollingTimers = new Map<number, ReturnType<typeof setInterval>>();
  private waitingTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private permissionTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private knownJsonlFiles = new Set<string>();
  private projectScanTimer: ReturnType<typeof setInterval> | null = null;
  private processes = new Map<number, ChildProcess>();
  private broadcast: MessageSink;

  // Cross-project agent monitoring
  private crossProjectAgents = new Map<number, AgentState>();
  private crossProjectFileWatchers = new Map<number, fs.FSWatcher>();
  private crossProjectPollingTimers = new Map<number, ReturnType<typeof setInterval>>();
  private crossProjectWaitingTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private crossProjectPermissionTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private crossProjectScanTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly projectDir: string,
    private readonly workspacePath: string,
    broadcast: MessageSink,
  ) {
    this.broadcast = broadcast;
  }

  setBroadcast(sink: MessageSink): void {
    this.broadcast = sink;
  }

  /** Start scanning for JSONL files */
  startScanning(): void {
    // Adopt recently active JSONL files as agents on startup
    const now = Date.now();
    try {
      const files = fs
        .readdirSync(this.projectDir)
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => path.join(this.projectDir, f));
      for (const f of files) {
        this.knownJsonlFiles.add(f);
        try {
          const stat = fs.statSync(f);
          if (now - stat.mtimeMs < ACTIVE_SESSION_MAX_AGE_MS) {
            this.adoptFile(f);
          }
        } catch {
          /* ignore stat errors */
        }
      }
    } catch {
      /* dir may not exist */
    }

    this.projectScanTimer = setInterval(() => {
      this.scanForNewJsonlFiles();
    }, PROJECT_SCAN_INTERVAL_MS);
  }

  /** Spawn a new Claude Code process */
  spawnAgent(): void {
    const sessionId = crypto.randomUUID();
    const expectedFile = path.join(this.projectDir, `${sessionId}.jsonl`);
    this.knownJsonlFiles.add(expectedFile);

    // Ensure project dir exists
    if (!fs.existsSync(this.projectDir)) {
      fs.mkdirSync(this.projectDir, { recursive: true });
    }

    const proc = spawn('claude', ['--session-id', sessionId], {
      cwd: this.workspacePath,
      stdio: 'ignore',
      detached: true,
    });
    proc.unref();

    const id = this.nextAgentId.current++;
    const terminalHandle = new ProcessTerminalHandle(`Claude Code #${id}`, proc);

    const agent: AgentState = {
      id,
      terminalRef: terminalHandle,
      projectDir: this.projectDir,
      jsonlFile: expectedFile,
      fileOffset: 0,
      lineBuffer: '',
      activeToolIds: new Set(),
      activeToolStatuses: new Map(),
      activeToolNames: new Map(),
      activeSubagentToolIds: new Map(),
      activeSubagentToolNames: new Map(),
      isWaiting: false,
      permissionSent: false,
      hadToolsInTurn: false,
      usage: createDefaultUsage(),
    };

    this.agents.set(id, agent);
    this.processes.set(id, proc);

    proc.on('exit', () => {
      this.removeAgent(id);
      this.broadcast.postMessage({ type: 'agentClosed', id });
    });

    const projectName = path.basename(this.workspacePath);
    this.broadcast.postMessage({ type: 'agentCreated', id, projectName });

    // Poll for JSONL file to appear
    const pollTimer = setInterval(() => {
      try {
        if (fs.existsSync(agent.jsonlFile)) {
          clearInterval(pollTimer);
          this.startFileWatching(id, agent.jsonlFile);
          this.readNewLines(id);
        }
      } catch {
        /* file may not exist yet */
      }
    }, 1000);

    // Store the poll timer so we can clean it up
    this.pollingTimers.set(id, pollTimer as unknown as ReturnType<typeof setInterval>);
  }

  /** Close an agent (kill process if spawned by us) */
  closeAgent(agentId: number): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    agent.terminalRef?.dispose();
    this.removeAgent(agentId);
    this.broadcast.postMessage({ type: 'agentClosed', id: agentId });
  }

  /** Get existing agent IDs for initial sync */
  getExistingAgentIds(): number[] {
    return [...this.agents.keys()].sort((a, b) => a - b);
  }

  /** Send current agent statuses (tools, waiting) */
  sendCurrentStatuses(sink: MessageSink): void {
    for (const [agentId, agent] of this.agents) {
      for (const [toolId, status] of agent.activeToolStatuses) {
        sink.postMessage({ type: 'agentToolStart', id: agentId, toolId, status });
      }
      if (agent.isWaiting) {
        sink.postMessage({ type: 'agentStatus', id: agentId, status: 'waiting' });
      }
    }
  }

  /** Start cross-project scanning to discover agents from all projects */
  startCrossProjectScanning(): void {
    if (this.crossProjectScanTimer) return;

    const scan = () => {
      const allDirs = getAllProjectDirs();
      const aliveIds = new Set<number>();

      // Phase 1: Discover new agents and track alive IDs
      for (const dirPath of allDirs) {
        const dirName = path.basename(dirPath);
        const isCurrent = dirPath === this.projectDir;
        if (isCurrent) continue;

        const activeFiles = getActiveJsonlFiles(dirPath, ACTIVE_SESSION_MAX_AGE_MS);

        for (const jsonlFile of activeFiles) {
          const filename = path.basename(jsonlFile);
          const agentId = generateCrossProjectAgentId(dirPath, filename);
          aliveIds.add(agentId);

          if (!this.crossProjectAgents.has(agentId)) {
            const agent: AgentState = {
              id: agentId,
              projectDir: dirPath,
              jsonlFile,
              fileOffset: 0,
              lineBuffer: '',
              activeToolIds: new Set(),
              activeToolStatuses: new Map(),
              activeToolNames: new Map(),
              activeSubagentToolIds: new Map(),
              activeSubagentToolNames: new Map(),
              isWaiting: false,
              permissionSent: false,
              hadToolsInTurn: false,
              projectId: dirName,
              isCrossProject: true,
              usage: createDefaultUsage(),
            };

            this.crossProjectAgents.set(agentId, agent);

            // Skip to end of file
            try {
              const stat = fs.statSync(jsonlFile);
              agent.fileOffset = stat.size;
            } catch {
              // ignore
            }

            this.startCrossProjectFileWatching(agentId, jsonlFile);

            const projectName = resolveProjectName(dirName);
            console.log(
              `[Pixel Agents Server] Cross-project agent ${agentId}: ${projectName} (${filename})`,
            );
            this.broadcast.postMessage({
              type: 'agentCreated',
              id: agentId,
              projectId: dirName,
              projectName,
              isCrossProject: true,
            });
          }
        }
      }

      // Phase 2: Remove agents no longer in active files
      for (const [agentId] of this.crossProjectAgents) {
        if (!aliveIds.has(agentId)) {
          this.removeCrossProjectAgent(agentId);
          this.broadcast.postMessage({ type: 'agentClosed', id: agentId });
        }
      }

      // Phase 3: Build project list AFTER removal for accurate counts
      const projects: ProjectInfo[] = [];
      const countByDir = new Map<string, number>();
      for (const agent of this.crossProjectAgents.values()) {
        countByDir.set(agent.projectDir, (countByDir.get(agent.projectDir) || 0) + 1);
      }

      for (const dirPath of allDirs) {
        const dirName = path.basename(dirPath);
        const isCurrent = dirPath === this.projectDir;

        if (isCurrent) {
          projects.push({
            id: dirName,
            name: resolveProjectName(dirName),
            dirPath,
            isCurrent: true,
            agentCount: this.agents.size,
          });
        } else {
          const count = countByDir.get(dirPath) || 0;
          if (count > 0) {
            projects.push({
              id: dirName,
              name: resolveProjectName(dirName),
              dirPath,
              isCurrent: false,
              agentCount: count,
            });
          }
        }
      }

      this.broadcast.postMessage({ type: 'projectsDiscovered', projects });
    };

    scan();
    this.crossProjectScanTimer = setInterval(scan, CROSS_PROJECT_SCAN_INTERVAL_MS);
  }

  /** Get all cross-project agent IDs */
  getCrossProjectAgentIds(): number[] {
    return [...this.crossProjectAgents.keys()].sort((a, b) => a - b);
  }

  /** Get the cross-project agents map (read-only access for tray/status) */
  getCrossProjectAgents(): ReadonlyMap<number, AgentState> {
    return this.crossProjectAgents;
  }

  /** Send current statuses for cross-project agents */
  sendCrossProjectStatuses(sink: MessageSink): void {
    for (const [agentId, agent] of this.crossProjectAgents) {
      for (const [toolId, status] of agent.activeToolStatuses) {
        sink.postMessage({ type: 'agentToolStart', id: agentId, toolId, status });
      }
      if (agent.isWaiting) {
        sink.postMessage({ type: 'agentStatus', id: agentId, status: 'waiting' });
      }
    }
  }

  private startCrossProjectFileWatching(agentId: number, filePath: string): void {
    try {
      const watcher = fs.watch(filePath, () => {
        this.readCrossProjectLines(agentId);
      });
      this.crossProjectFileWatchers.set(agentId, watcher);
    } catch {
      // fs.watch may fail
    }

    const interval = setInterval(() => {
      if (!this.crossProjectAgents.has(agentId)) {
        clearInterval(interval);
        return;
      }
      this.readCrossProjectLines(agentId);
    }, FILE_WATCHER_POLL_INTERVAL_MS);
    this.crossProjectPollingTimers.set(agentId, interval);
  }

  private readCrossProjectLines(agentId: number): void {
    const agent = this.crossProjectAgents.get(agentId);
    if (!agent) return;

    try {
      const stat = fs.statSync(agent.jsonlFile);
      if (stat.size <= agent.fileOffset) return;

      const buf = Buffer.alloc(stat.size - agent.fileOffset);
      const fd = fs.openSync(agent.jsonlFile, 'r');
      fs.readSync(fd, buf, 0, buf.length, agent.fileOffset);
      fs.closeSync(fd);
      agent.fileOffset = stat.size;

      const text = agent.lineBuffer + buf.toString('utf-8');
      const lines = text.split('\n');
      agent.lineBuffer = lines.pop() || '';

      const hasLines = lines.some((l) => l.trim());
      if (hasLines) {
        cancelWaitingTimer(agentId, this.crossProjectWaitingTimers);
        cancelPermissionTimer(agentId, this.crossProjectPermissionTimers);
        if (agent.permissionSent) {
          agent.permissionSent = false;
          this.broadcast.postMessage({ type: 'agentToolPermissionClear', id: agentId });
        }
      }

      for (const line of lines) {
        if (!line.trim()) continue;
        processTranscriptLine(
          agentId,
          line,
          this.crossProjectAgents,
          this.crossProjectWaitingTimers,
          this.crossProjectPermissionTimers,
          this.broadcast,
        );
      }
    } catch {
      // ignore read errors
    }
  }

  private removeCrossProjectAgent(agentId: number): void {
    const agent = this.crossProjectAgents.get(agentId);
    if (!agent) return;

    this.crossProjectFileWatchers.get(agentId)?.close();
    this.crossProjectFileWatchers.delete(agentId);

    const pt = this.crossProjectPollingTimers.get(agentId);
    if (pt) clearInterval(pt);
    this.crossProjectPollingTimers.delete(agentId);

    cancelWaitingTimer(agentId, this.crossProjectWaitingTimers);
    cancelPermissionTimer(agentId, this.crossProjectPermissionTimers);
    this.crossProjectAgents.delete(agentId);
  }

  dispose(): void {
    if (this.projectScanTimer) {
      clearInterval(this.projectScanTimer);
      this.projectScanTimer = null;
    }
    for (const id of [...this.agents.keys()]) {
      this.removeAgent(id);
    }
    // Clean up cross-project scanning
    if (this.crossProjectScanTimer) {
      clearInterval(this.crossProjectScanTimer);
      this.crossProjectScanTimer = null;
    }
    for (const id of [...this.crossProjectAgents.keys()]) {
      this.removeCrossProjectAgent(id);
    }
  }

  // ── Private ────────────────────────────────────────────────

  private removeAgent(agentId: number): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    this.fileWatchers.get(agentId)?.close();
    this.fileWatchers.delete(agentId);
    const pt = this.pollingTimers.get(agentId);
    if (pt) clearInterval(pt);
    this.pollingTimers.delete(agentId);
    try {
      fs.unwatchFile(agent.jsonlFile);
    } catch {
      /* ignore */
    }
    cancelWaitingTimer(agentId, this.waitingTimers);
    cancelPermissionTimer(agentId, this.permissionTimers);
    this.processes.delete(agentId);
    this.agents.delete(agentId);
  }

  private scanForNewJsonlFiles(): void {
    let files: string[];
    try {
      files = fs
        .readdirSync(this.projectDir)
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => path.join(this.projectDir, f));
    } catch {
      return;
    }

    for (const file of files) {
      if (!this.knownJsonlFiles.has(file)) {
        this.knownJsonlFiles.add(file);
        this.adoptFile(file);
      }
    }
  }

  private adoptFile(jsonlFile: string): void {
    const id = this.nextAgentId.current++;
    const agent: AgentState = {
      id,
      projectDir: this.projectDir,
      jsonlFile,
      fileOffset: 0,
      lineBuffer: '',
      activeToolIds: new Set(),
      activeToolStatuses: new Map(),
      activeToolNames: new Map(),
      activeSubagentToolIds: new Map(),
      activeSubagentToolNames: new Map(),
      isWaiting: false,
      permissionSent: false,
      hadToolsInTurn: false,
      usage: createDefaultUsage(),
    };

    this.agents.set(id, agent);
    console.log(`[Pixel Agents Server] Agent ${id}: adopted ${path.basename(jsonlFile)}`);
    const projectName = path.basename(this.workspacePath);
    this.broadcast.postMessage({ type: 'agentCreated', id, projectName });

    this.startFileWatching(id, jsonlFile);
    this.readNewLines(id);
  }

  private startFileWatching(agentId: number, filePath: string): void {
    // Primary: fs.watch
    try {
      const watcher = fs.watch(filePath, () => {
        this.readNewLines(agentId);
      });
      this.fileWatchers.set(agentId, watcher);
    } catch (e) {
      console.log(`[Pixel Agents Server] fs.watch failed for agent ${agentId}: ${e}`);
    }

    // Secondary: fs.watchFile
    try {
      fs.watchFile(filePath, { interval: FILE_WATCHER_POLL_INTERVAL_MS }, () => {
        this.readNewLines(agentId);
      });
    } catch (e) {
      console.log(`[Pixel Agents Server] fs.watchFile failed for agent ${agentId}: ${e}`);
    }

    // Tertiary: manual poll
    const interval = setInterval(() => {
      if (!this.agents.has(agentId)) {
        clearInterval(interval);
        try {
          fs.unwatchFile(filePath);
        } catch {
          /* ignore */
        }
        return;
      }
      this.readNewLines(agentId);
    }, FILE_WATCHER_POLL_INTERVAL_MS);
    // Don't overwrite the poll timer from spawnAgent if one exists
    if (!this.pollingTimers.has(agentId)) {
      this.pollingTimers.set(agentId, interval);
    }
  }

  private readNewLines(agentId: number): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    try {
      const stat = fs.statSync(agent.jsonlFile);
      if (stat.size <= agent.fileOffset) return;

      const buf = Buffer.alloc(stat.size - agent.fileOffset);
      const fd = fs.openSync(agent.jsonlFile, 'r');
      fs.readSync(fd, buf, 0, buf.length, agent.fileOffset);
      fs.closeSync(fd);
      agent.fileOffset = stat.size;

      const text = agent.lineBuffer + buf.toString('utf-8');
      const lines = text.split('\n');
      agent.lineBuffer = lines.pop() || '';

      const hasLines = lines.some((l) => l.trim());
      if (hasLines) {
        cancelWaitingTimer(agentId, this.waitingTimers);
        cancelPermissionTimer(agentId, this.permissionTimers);
        if (agent.permissionSent) {
          agent.permissionSent = false;
          this.broadcast.postMessage({ type: 'agentToolPermissionClear', id: agentId });
        }
      }

      for (const line of lines) {
        if (!line.trim()) continue;
        processTranscriptLine(
          agentId,
          line,
          this.agents,
          this.waitingTimers,
          this.permissionTimers,
          this.broadcast,
        );
      }
    } catch (e) {
      console.log(`[Pixel Agents Server] Read error for agent ${agentId}: ${e}`);
    }
  }
}
