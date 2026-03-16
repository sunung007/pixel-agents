import { useEffect, useState } from 'react';

import { USAGE_BAR_HEIGHT_PX, USAGE_ELAPSED_UPDATE_INTERVAL_MS } from '../constants.js';
import type { AgentUsageData } from '../hooks/useExtensionMessages.js';

interface UsageStatusBarProps {
  agents: number[];
  selectedAgent: number | null;
  agentUsage: Record<number, AgentUsageData>;
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatElapsed(startIso: string | null): string {
  if (!startIso) return '--';
  const elapsed = Date.now() - new Date(startIso).getTime();
  if (elapsed < 0) return '--';
  const mins = Math.floor(elapsed / 60000);
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  if (hours > 0) return `${hours}h ${remainMins}m`;
  return `${remainMins}m`;
}

function formatResetTime(): string {
  const now = new Date();
  const nextMidnight = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0),
  );
  const diff = nextMidnight.getTime() - now.getTime();
  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  return `${hours}h ${mins}m`;
}

const barStyle: React.CSSProperties = {
  flexShrink: 0,
  height: USAGE_BAR_HEIGHT_PX,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 16,
  background: 'var(--pixel-bg)',
  borderTop: '2px solid var(--pixel-border)',
  fontSize: '12px',
  color: 'var(--pixel-text-dim)',
  userSelect: 'none',
  fontFamily: 'var(--pixel-font)',
};

const labelStyle: React.CSSProperties = {
  opacity: 0.6,
};

const valueStyle: React.CSSProperties = {
  color: 'var(--pixel-text)',
};

const separatorStyle: React.CSSProperties = {
  opacity: 0.3,
};

export function UsageStatusBar({ agents, selectedAgent, agentUsage }: UsageStatusBarProps) {
  const [, setTick] = useState(0);

  // Update elapsed time every second
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), USAGE_ELAPSED_UPDATE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  // Compute display values
  let totalInput = 0;
  let totalOutput = 0;
  let totalTurns = 0;
  let sessionStart: string | null = null;

  if (selectedAgent !== null && agentUsage[selectedAgent]) {
    const u = agentUsage[selectedAgent];
    totalInput = u.inputTokens + u.cacheReadTokens + u.cacheCreationTokens;
    totalOutput = u.outputTokens;
    totalTurns = u.turnCount;
    sessionStart = u.sessionStartTime;
  } else {
    // Aggregate all agents
    for (const id of agents) {
      const u = agentUsage[id];
      if (!u) continue;
      totalInput += u.inputTokens + u.cacheReadTokens + u.cacheCreationTokens;
      totalOutput += u.outputTokens;
      totalTurns += u.turnCount;
      // Use earliest session start
      if (u.sessionStartTime) {
        if (!sessionStart || u.sessionStartTime < sessionStart) {
          sessionStart = u.sessionStartTime;
        }
      }
    }
  }

  const hasData = agents.length > 0;

  return (
    <div style={barStyle}>
      {hasData ? (
        <>
          <span>
            <span style={labelStyle}>입력 </span>
            <span style={valueStyle}>{formatTokenCount(totalInput)}</span>
          </span>
          <span style={separatorStyle}>|</span>
          <span>
            <span style={labelStyle}>출력 </span>
            <span style={valueStyle}>{formatTokenCount(totalOutput)}</span>
          </span>
          <span style={separatorStyle}>|</span>
          <span>
            <span style={labelStyle}>턴 </span>
            <span style={valueStyle}>{totalTurns}</span>
          </span>
          <span style={separatorStyle}>|</span>
          <span>
            <span style={labelStyle}>경과 </span>
            <span style={valueStyle}>{formatElapsed(sessionStart)}</span>
          </span>
          <span style={separatorStyle}>|</span>
          <span>
            <span style={labelStyle}>리셋 </span>
            <span style={valueStyle}>{formatResetTime()}</span>
          </span>
        </>
      ) : (
        <span style={labelStyle}>에이전트를 추가하세요</span>
      )}
    </div>
  );
}
