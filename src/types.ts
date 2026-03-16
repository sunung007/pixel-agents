/**
 * Minimal terminal interface.
 * vscode.Terminal satisfies this, and standalone mode provides its own implementation.
 */
export interface TerminalHandle {
  readonly name: string;
  show(): void;
  dispose(): void;
}

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  turnCount: number;
  sessionStartTime: string | null;
}

export function createDefaultUsage(): AgentUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    turnCount: 0,
    sessionStartTime: null,
  };
}

export interface AgentState {
  id: number;
  terminalRef?: TerminalHandle;
  projectDir: string;
  jsonlFile: string;
  fileOffset: number;
  lineBuffer: string;
  activeToolIds: Set<string>;
  activeToolStatuses: Map<string, string>;
  activeToolNames: Map<string, string>;
  activeSubagentToolIds: Map<string, Set<string>>; // parentToolId → active sub-tool IDs
  activeSubagentToolNames: Map<string, Map<string, string>>; // parentToolId → (subToolId → toolName)
  isWaiting: boolean;
  permissionSent: boolean;
  hadToolsInTurn: boolean;
  /** Workspace folder name (only set for multi-root workspaces) */
  folderName?: string;
  /** Sanitized project directory name (unique per project, used for cross-project filtering) */
  projectId?: string;
  /** Whether this is a cross-project agent (no terminal, read-only monitoring) */
  isCrossProject?: boolean;
  /** Cumulative token usage for this session */
  usage: AgentUsage;
}

export interface PersistedAgent {
  id: number;
  terminalName: string;
  jsonlFile: string;
  projectDir: string;
  /** Workspace folder name (only set for multi-root workspaces) */
  folderName?: string;
}
