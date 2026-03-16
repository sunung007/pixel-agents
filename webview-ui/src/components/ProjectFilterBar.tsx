import { useState } from 'react';

import type { ProjectInfo } from '../hooks/useExtensionMessages.js';

interface ProjectFilterBarProps {
  projects: ProjectInfo[];
  filter: Set<string>;
  onFilterChange: (filter: Set<string>) => void;
}

const barStyle: React.CSSProperties = {
  position: 'absolute',
  top: 8,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 'var(--pixel-controls-z)',
  display: 'flex',
  gap: 3,
  alignItems: 'center',
  background: 'var(--pixel-bg)',
  border: '2px solid var(--pixel-border)',
  borderRadius: 0,
  padding: '3px 5px',
  boxShadow: 'var(--pixel-shadow)',
};

const btnBase: React.CSSProperties = {
  padding: '3px 8px',
  fontSize: '12px',
  color: 'var(--pixel-text)',
  background: 'var(--pixel-btn-bg)',
  border: '2px solid transparent',
  borderRadius: 0,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const btnActive: React.CSSProperties = {
  ...btnBase,
  background: 'var(--pixel-active-bg)',
  border: '2px solid var(--pixel-accent)',
};

export function ProjectFilterBar({ projects, filter, onFilterChange }: ProjectFilterBarProps) {
  const [hovered, setHovered] = useState<string | null>(null);

  const isShowAll = filter.size === 0;

  const totalCount = projects.reduce((sum, p) => sum + p.agentCount, 0);

  const handleAllClick = () => {
    onFilterChange(new Set());
  };

  const handleProjectClick = (projectId: string) => {
    if (isShowAll) {
      // Switching from "show all" to single project
      onFilterChange(new Set([projectId]));
    } else if (filter.has(projectId)) {
      const next = new Set(filter);
      next.delete(projectId);
      // If nothing selected, revert to show all
      onFilterChange(next);
    } else {
      const next = new Set(filter);
      next.add(projectId);
      onFilterChange(next);
    }
  };

  const isProjectActive = (projectId: string) => isShowAll || filter.has(projectId);

  // Sort: current project first, then alphabetical
  const sorted = [...projects].sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div style={barStyle}>
      <button
        onClick={handleAllClick}
        onMouseEnter={() => setHovered('all')}
        onMouseLeave={() => setHovered(null)}
        style={
          isShowAll
            ? btnActive
            : {
                ...btnBase,
                background: hovered === 'all' ? 'var(--pixel-btn-hover-bg)' : btnBase.background,
              }
        }
      >
        전체 ({totalCount})
      </button>
      {sorted.map((project) => {
        const count = project.agentCount;
        const active = isProjectActive(project.id);
        const key = `proj-${project.id}`;
        return (
          <button
            key={key}
            onClick={() => handleProjectClick(project.id)}
            onMouseEnter={() => setHovered(key)}
            onMouseLeave={() => setHovered(null)}
            style={
              active && !isShowAll
                ? {
                    ...btnActive,
                    border: project.isCurrent
                      ? '2px solid var(--pixel-accent)'
                      : '2px solid var(--pixel-border-light)',
                  }
                : {
                    ...btnBase,
                    background: hovered === key ? 'var(--pixel-btn-hover-bg)' : btnBase.background,
                    opacity: isShowAll ? 1 : 0.5,
                  }
            }
            title={project.dirPath}
          >
            {project.name} ({count})
          </button>
        );
      })}
    </div>
  );
}
