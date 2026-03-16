import { useEffect, useRef } from 'react';

import type { OfficeState } from '../office/engine/officeState.js';
import type { ToolActivity } from '../office/types.js';
import { vscode } from '../vscodeApi.js';

interface DebugViewProps {
  agents: number[];
  selectedAgent: number | null;
  agentTools: Record<number, ToolActivity[]>;
  agentStatuses: Record<number, string>;
  subagentTools: Record<number, Record<string, ToolActivity[]>>;
  onSelectAgent: (id: number) => void;
  officeState?: OfficeState;
}

function ToolDot({ tool }: { tool: ToolActivity }) {
  return (
    <span
      className={tool.done ? undefined : 'pixel-agents-pulse'}
      style={{
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: tool.done
          ? 'var(--vscode-charts-green, #89d185)'
          : tool.permissionWait
            ? 'var(--vscode-charts-yellow, #cca700)'
            : 'var(--vscode-charts-blue, #3794ff)',
        display: 'inline-block',
        flexShrink: 0,
        marginTop: '5px',
      }}
    />
  );
}

function ToolLine({ tool }: { tool: ToolActivity }) {
  return (
    <span
      style={{
        fontFamily: 'var(--pixel-font-code)',
        fontSize: 'var(--pixel-debug-font-size, 12px)',
        opacity: tool.done ? 0.5 : 0.8,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 5,
        minWidth: 0,
        wordBreak: 'break-word',
      }}
    >
      <ToolDot tool={tool} />
      <span style={{ minWidth: 0 }}>
        {tool.permissionWait && !tool.done ? '승인 대기' : tool.status}
      </span>
    </span>
  );
}

export function DebugView({
  agents,
  selectedAgent,
  agentTools,
  agentStatuses,
  subagentTools,
  onSelectAgent,
  officeState,
}: DebugViewProps) {
  const cardRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Scroll selected agent card into view
  useEffect(() => {
    if (selectedAgent !== null) {
      const el = cardRefs.current.get(selectedAgent);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [selectedAgent]);

  const renderAgentCard = (id: number) => {
    const ch = officeState?.characters.get(id);
    const isCrossProject = ch?.isCrossProject;
    const isSelected = selectedAgent === id;
    const tools = agentTools[id] || [];
    const subs = subagentTools[id] || {};
    const status = agentStatuses[id];
    const hasActiveTools = tools.some((t) => !t.done);
    return (
      <div
        key={id}
        ref={(el) => {
          if (el) cardRefs.current.set(id, el);
          else cardRefs.current.delete(id);
        }}
        style={{
          border: `2px solid ${isSelected ? '#5a8cff' : '#4a4a6a'}`,
          borderRadius: 0,
          padding: '6px 8px',
          minWidth: 0,
          overflow: 'hidden',
          background: isSelected
            ? 'var(--vscode-list-activeSelectionBackground, rgba(255,255,255,0.04))'
            : undefined,
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 0, flexWrap: 'wrap' }}>
          <button
            onClick={() => onSelectAgent(id)}
            style={{
              borderRadius: 0,
              padding: '4px 8px',
              fontSize: '12px',
              background: isSelected ? 'rgba(90, 140, 255, 0.25)' : undefined,
              color: isSelected ? '#fff' : undefined,
              fontWeight: isSelected ? 'bold' : undefined,
            }}
          >
            {isCrossProject && ch?.projectName ? `${ch.projectName} #${id}` : `에이전트 #${id}`}
          </button>
          {isCrossProject && (
            <span
              style={{
                fontSize: '10px',
                color: 'var(--pixel-text-dim)',
                padding: '2px 5px',
                opacity: 0.7,
              }}
            >
              (외부)
            </span>
          )}
          {!isCrossProject && (
            <button
              onClick={() => vscode.postMessage({ type: 'closeAgent', id })}
              style={{
                borderRadius: 0,
                padding: '4px 6px',
                fontSize: '12px',
                opacity: 0.7,
                background: isSelected ? 'rgba(90, 140, 255, 0.25)' : undefined,
                color: isSelected ? '#fff' : undefined,
              }}
              title="에이전트 닫기"
            >
              ✕
            </button>
          )}
        </span>
        {(tools.length > 0 || status === 'waiting') && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
              marginTop: 4,
              paddingLeft: 4,
            }}
          >
            {tools.map((tool) => (
              <div key={tool.toolId}>
                <ToolLine tool={tool} />
                {subs[tool.toolId] && subs[tool.toolId].length > 0 && (
                  <div
                    style={{
                      borderLeft: '2px solid var(--vscode-widget-border, rgba(255,255,255,0.12))',
                      marginLeft: 3,
                      paddingLeft: 8,
                      marginTop: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 1,
                    }}
                  >
                    {subs[tool.toolId].map((subTool) => (
                      <ToolLine key={subTool.toolId} tool={subTool} />
                    ))}
                  </div>
                )}
              </div>
            ))}
            {status === 'waiting' && !hasActiveTools && (
              <span
                style={{
                  fontFamily: 'var(--pixel-font-code)',
                  fontSize: 'var(--pixel-debug-font-size, 12px)',
                  opacity: 0.85,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: 'var(--vscode-charts-yellow, #cca700)',
                    display: 'inline-block',
                    flexShrink: 0,
                  }}
                />
                입력 대기 중
              </span>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      style={{
        background: 'var(--pixel-bg)',
        // borderLeft: '2px solid var(--pixel-border)',
        borderTop: '2px solid var(--pixel-border)',
        overflow: 'auto',
        padding: '8px',
        color: 'var(--pixel-debug-text)',
        minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {agents.length === 0 && (
          <div
            style={{
              fontFamily: 'var(--pixel-font-code)',
              fontSize: 'var(--pixel-debug-font-size, 12px)',
              color: 'var(--pixel-text-dim)',
              padding: '8px 4px',
            }}
          >
            활성 에이전트 없음
          </div>
        )}
        {agents.map(renderAgentCard)}
      </div>
    </div>
  );
}
