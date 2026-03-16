import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { CROSS_PROJECT_AGENT_ID_OFFSET, CROSS_PROJECT_STALE_THRESHOLD_MS } from '../constants.js';

// ── Types ────────────────────────────────────────────────────

export interface ProjectInfo {
  /** Sanitized directory name (unique per project) */
  id: string;
  /** Human-readable project name (e.g., "pixel-agents") */
  name: string;
  /** Full path to project directory under ~/.claude/projects/ */
  dirPath: string;
  /** Whether this is the current workspace's project */
  isCurrent: boolean;
  /** Number of active agents in this project */
  agentCount: number;
}

// ── Project name resolution cache ─────────────────────────────

const nameCache = new Map<string, string>();

// ── Exports ──────────────────────────────────────────────────

/**
 * Get all project directories under ~/.claude/projects/.
 * Returns full paths to each subdirectory.
 */
export function getAllProjectDirs(): string[] {
  const projectsRoot = path.join(os.homedir(), '.claude', 'projects');
  try {
    const entries = fs.readdirSync(projectsRoot, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => path.join(projectsRoot, e.name));
  } catch {
    return [];
  }
}

/**
 * Derive a human-readable project name from a sanitized directory name.
 *
 * The directory name is the original workspace path with all non-[a-zA-Z0-9-]
 * characters replaced by '-'. We try to reconstruct the original path by
 * greedily joining trailing segments with '-' and checking if the path exists.
 */
export function resolveProjectName(dirName: string): string {
  if (nameCache.has(dirName)) return nameCache.get(dirName)!;

  const segments = dirName.replace(/^-+/, '').split('-').filter(Boolean);
  if (segments.length === 0) {
    nameCache.set(dirName, dirName);
    return dirName;
  }

  // Try greedy path reconstruction from the end:
  // For each split point, join the prefix with '/' and the suffix with '-'
  // Check if the resulting full path exists as a directory
  for (let joinFrom = segments.length - 1; joinFrom >= 1; joinFrom--) {
    const prefix = '/' + segments.slice(0, joinFrom).join('/');
    const suffix = segments.slice(joinFrom).join('-');
    const fullPath = prefix + '/' + suffix;
    try {
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
        nameCache.set(dirName, suffix);
        return suffix;
      }
    } catch {
      // ignore stat errors
    }
  }

  // Fallback: use the last segment
  const fallback = segments[segments.length - 1];
  nameCache.set(dirName, fallback);
  return fallback;
}

/**
 * Get JSONL files in a project directory that have been modified within maxAgeMs.
 * Returns full paths sorted by mtime (most recent first).
 */
export function getActiveJsonlFiles(projectDir: string, maxAgeMs: number): string[] {
  const now = Date.now();
  try {
    const files = fs.readdirSync(projectDir).filter((f) => f.endsWith('.jsonl'));

    const active: Array<{ path: string; mtime: number }> = [];
    for (const f of files) {
      const fullPath = path.join(projectDir, f);
      try {
        const stat = fs.statSync(fullPath);
        if (now - stat.mtimeMs < maxAgeMs) {
          active.push({ path: fullPath, mtime: stat.mtimeMs });
        }
      } catch {
        // ignore stat errors
      }
    }

    return active.sort((a, b) => b.mtime - a.mtime).map((a) => a.path);
  } catch {
    return [];
  }
}

/**
 * Check if a JSONL file is stale (not modified within the threshold).
 */
export function isJsonlStale(jsonlPath: string): boolean {
  try {
    const stat = fs.statSync(jsonlPath);
    return Date.now() - stat.mtimeMs > CROSS_PROJECT_STALE_THRESHOLD_MS;
  } catch {
    return true;
  }
}

/**
 * Generate a deterministic agent ID for a cross-project agent.
 * Uses a simple hash of the project dir name + JSONL filename
 * to produce a stable ID in the 10000+ range.
 */
export function generateCrossProjectAgentId(projectDir: string, jsonlFilename: string): number {
  const key = path.basename(projectDir) + ':' + jsonlFilename;
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  }
  // Ensure positive, in range [OFFSET, OFFSET + 89999]
  return CROSS_PROJECT_AGENT_ID_OFFSET + ((hash >>> 0) % 90000);
}
