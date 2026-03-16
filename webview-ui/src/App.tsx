import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { BottomToolbar } from './components/BottomToolbar.js';
import { DebugView } from './components/DebugView.js';
import { ProjectFilterBar } from './components/ProjectFilterBar.js';
import { UsageStatusBar } from './components/UsageStatusBar.js';
import { ZoomControls } from './components/ZoomControls.js';
import { PULSE_ANIMATION_DURATION_SEC } from './constants.js';
import { useEditorActions } from './hooks/useEditorActions.js';
import { useEditorKeyboard } from './hooks/useEditorKeyboard.js';
import { useExtensionMessages } from './hooks/useExtensionMessages.js';
import { OfficeCanvas } from './office/components/OfficeCanvas.js';
import { ToolOverlay } from './office/components/ToolOverlay.js';
import { EditorState } from './office/editor/editorState.js';
import { EditorToolbar } from './office/editor/EditorToolbar.js';
import { OfficeState } from './office/engine/officeState.js';
import { isRotatable } from './office/layout/furnitureCatalog.js';
import { EditTool } from './office/types.js';
import { vscode } from './vscodeApi.js';

// Game state lives outside React — updated imperatively by message handlers
const officeStateRef = { current: null as OfficeState | null };
const editorState = new EditorState();

function getOfficeState(): OfficeState {
  if (!officeStateRef.current) {
    officeStateRef.current = new OfficeState();
  }
  return officeStateRef.current;
}

const actionBarBtnStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: '13px',
  background: 'var(--pixel-btn-bg)',
  color: 'var(--pixel-text-dim)',
  border: '2px solid transparent',
  borderRadius: 0,
  cursor: 'pointer',
};

const actionBarBtnDisabled: React.CSSProperties = {
  ...actionBarBtnStyle,
  opacity: 'var(--pixel-btn-disabled-opacity)',
  cursor: 'default',
};

function EditActionBar({
  editor,
  editorState: es,
}: {
  editor: ReturnType<typeof useEditorActions>;
  editorState: EditorState;
}) {
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const undoDisabled = es.undoStack.length === 0;
  const redoDisabled = es.redoStack.length === 0;

  return (
    <div
      style={{
        position: 'absolute',
        top: 8,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 'var(--pixel-controls-z)',
        display: 'flex',
        gap: 4,
        alignItems: 'center',
        background: 'var(--pixel-bg)',
        border: '2px solid var(--pixel-border)',
        borderRadius: 0,
        padding: '4px 8px',
        boxShadow: 'var(--pixel-shadow)',
      }}
    >
      <button
        style={undoDisabled ? actionBarBtnDisabled : actionBarBtnStyle}
        onClick={undoDisabled ? undefined : editor.handleUndo}
        title="Undo (Ctrl+Z)"
      >
        Undo
      </button>
      <button
        style={redoDisabled ? actionBarBtnDisabled : actionBarBtnStyle}
        onClick={redoDisabled ? undefined : editor.handleRedo}
        title="Redo (Ctrl+Y)"
      >
        Redo
      </button>
      <button style={actionBarBtnStyle} onClick={editor.handleSave} title="Save layout">
        Save
      </button>
      {!showResetConfirm ? (
        <button
          style={actionBarBtnStyle}
          onClick={() => setShowResetConfirm(true)}
          title="Reset to last saved layout"
        >
          Reset
        </button>
      ) : (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ fontSize: '13px', color: 'var(--pixel-reset-text)' }}>Reset?</span>
          <button
            style={{ ...actionBarBtnStyle, background: 'var(--pixel-danger-bg)', color: '#fff' }}
            onClick={() => {
              setShowResetConfirm(false);
              editor.handleReset();
            }}
          >
            Yes
          </button>
          <button style={actionBarBtnStyle} onClick={() => setShowResetConfirm(false)}>
            No
          </button>
        </div>
      )}
    </div>
  );
}

function App() {
  const editor = useEditorActions(getOfficeState, editorState);

  const isEditDirty = useCallback(
    () => editor.isEditMode && editor.isDirty,
    [editor.isEditMode, editor.isDirty],
  );

  const {
    agents,
    selectedAgent,
    agentTools,
    agentStatuses,
    subagentTools,
    subagentCharacters,
    layoutReady,
    layoutWasReset,
    loadedAssets,
    workspaceFolders,
    projects,
    projectFilter,
    setProjectFilter,
    agentProjectMap,
    agentUsage,
    setSelectedAgent,
  } = useExtensionMessages(getOfficeState, editor.setLastSavedLayout, isEditDirty);

  // Treat unassigned agents as belonging to the current project
  const currentProjectId = useMemo(() => {
    return projects.find((p) => p.isCurrent)?.id;
  }, [projects]);

  // Compute visible agents based on project filter
  const visibleAgents = useMemo(() => {
    if (projectFilter.size === 0) return agents; // show all
    return agents.filter((id) => {
      const pid = agentProjectMap.get(id) ?? currentProjectId;
      if (!pid) return true; // no project info at all yet
      return projectFilter.has(pid);
    });
  }, [agents, projectFilter, agentProjectMap, currentProjectId]);

  const hiddenAgentIds = useMemo(() => {
    if (projectFilter.size === 0) return new Set<number>();
    const hidden = new Set<number>();
    for (const id of agents) {
      const pid = agentProjectMap.get(id) ?? currentProjectId;
      if (pid && !projectFilter.has(pid)) {
        hidden.add(id);
      }
    }
    return hidden;
  }, [agents, projectFilter, agentProjectMap, currentProjectId]);

  // Show migration notice once layout reset is detected
  const [migrationNoticeDismissed, setMigrationNoticeDismissed] = useState(false);
  const showMigrationNotice = layoutWasReset && !migrationNoticeDismissed;

  const [isDebugMode, setIsDebugMode] = useState(true);

  const handleToggleDebugMode = useCallback(() => setIsDebugMode((prev) => !prev), []);

  // Debug panel position and size
  const [debugPosition, setDebugPosition] = useState<'right' | 'bottom'>(() => {
    try {
      const saved = localStorage.getItem('pixel-agents-debug-position');
      if (saved === 'right' || saved === 'bottom') return saved;
    } catch {
      /* ignore */
    }
    return 'right';
  });
  const [debugPanelWidth, setDebugPanelWidth] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('pixel-agents-debug-size') || '{}');
      return saved.width || 280;
    } catch {
      return 280;
    }
  });
  const [debugPanelHeight, setDebugPanelHeight] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('pixel-agents-debug-size') || '{}');
      return saved.height || 200;
    } catch {
      return 200;
    }
  });
  const isResizing = useRef(false);
  const outerRef = useRef<HTMLDivElement>(null);

  const handleDebugPositionChange = useCallback((pos: 'right' | 'bottom') => {
    setDebugPosition(pos);
    localStorage.setItem('pixel-agents-debug-position', pos);
  }, []);

  // Persist size on change
  useEffect(() => {
    localStorage.setItem(
      'pixel-agents-debug-size',
      JSON.stringify({ width: debugPanelWidth, height: debugPanelHeight }),
    );
  }, [debugPanelWidth, debugPanelHeight]);

  // Resize handler
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizing.current = true;
      const startX = e.clientX;
      const startY = e.clientY;
      const startWidth = debugPanelWidth;
      const startHeight = debugPanelHeight;

      const onMouseMove = (ev: MouseEvent) => {
        if (!isResizing.current || !outerRef.current) return;
        const rect = outerRef.current.getBoundingClientRect();
        if (debugPosition === 'right') {
          const newWidth = Math.max(
            150,
            Math.min(rect.width * 0.5, startWidth - (ev.clientX - startX)),
          );
          setDebugPanelWidth(Math.round(newWidth));
        } else {
          const newHeight = Math.max(
            100,
            Math.min(rect.height * 0.6, startHeight - (ev.clientY - startY)),
          );
          setDebugPanelHeight(Math.round(newHeight));
        }
      };
      const onMouseUp = () => {
        isResizing.current = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.removeProperty('user-select');
        document.body.style.removeProperty('cursor');
      };
      document.body.style.userSelect = 'none';
      document.body.style.cursor = debugPosition === 'right' ? 'col-resize' : 'row-resize';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [debugPosition, debugPanelWidth, debugPanelHeight],
  );

  const handleSelectAgent = useCallback(
    (id: number) => {
      // Sync canvas selection + camera follow
      const os = getOfficeState();
      os.selectedAgentId = id;
      os.cameraFollowId = id;
      setSelectedAgent(id);
      vscode.postMessage({ type: 'focusAgent', id });
    },
    [setSelectedAgent],
  );

  const containerRef = useRef<HTMLDivElement>(null);

  const [editorTickForKeyboard, setEditorTickForKeyboard] = useState(0);
  useEditorKeyboard(
    editor.isEditMode,
    editorState,
    editor.handleDeleteSelected,
    editor.handleRotateSelected,
    editor.handleToggleState,
    editor.handleUndo,
    editor.handleRedo,
    useCallback(() => setEditorTickForKeyboard((n) => n + 1), []),
    editor.handleToggleEditMode,
  );

  const handleCloseAgent = useCallback((id: number) => {
    vscode.postMessage({ type: 'closeAgent', id });
  }, []);

  const handleClick = useCallback(
    (agentId: number) => {
      const os = getOfficeState();
      const ch = os.characters.get(agentId);
      // Sync debug panel selection
      const meta = os.subagentMeta.get(agentId);
      const selectId = meta ? meta.parentAgentId : agentId;
      setSelectedAgent(selectId);
      // Cross-project agents have no terminal — just select/follow
      if (ch?.isCrossProject) return;
      // If clicked agent is a sub-agent, focus the parent's terminal instead
      vscode.postMessage({ type: 'focusAgent', id: selectId });
    },
    [setSelectedAgent],
  );

  const officeState = getOfficeState();

  // Force dependency on editorTickForKeyboard to propagate keyboard-triggered re-renders
  void editorTickForKeyboard;

  // Show "Press R to rotate" hint when a rotatable item is selected or being placed
  const showRotateHint =
    editor.isEditMode &&
    (() => {
      if (editorState.selectedFurnitureUid) {
        const item = officeState
          .getLayout()
          .furniture.find((f) => f.uid === editorState.selectedFurnitureUid);
        if (item && isRotatable(item.type)) return true;
      }
      if (
        editorState.activeTool === EditTool.FURNITURE_PLACE &&
        isRotatable(editorState.selectedFurnitureType)
      ) {
        return true;
      }
      return false;
    })();

  if (!layoutReady) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--vscode-foreground)',
        }}
      >
        Loading...
      </div>
    );
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        ref={outerRef}
        className="pixel-agents-outer"
        style={{
          flex: 1,
          display: 'flex',
          overflow: 'hidden',
          minHeight: 0,
          flexDirection: debugPosition === 'right' ? 'row' : 'column',
        }}
      >
        <style>{`
        @keyframes pixel-agents-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        .pixel-agents-pulse { animation: pixel-agents-pulse ${PULSE_ANIMATION_DURATION_SEC}s ease-in-out infinite; }
        .pixel-agents-migration-btn:hover { filter: brightness(0.8); }
      `}</style>

        {/* Canvas area */}
        <div
          ref={containerRef}
          style={{ flex: 1, position: 'relative', overflow: 'hidden', minWidth: 0, minHeight: 0 }}
        >
          <OfficeCanvas
            officeState={officeState}
            onClick={handleClick}
            isEditMode={editor.isEditMode}
            editorState={editorState}
            onEditorTileAction={editor.handleEditorTileAction}
            onEditorEraseAction={editor.handleEditorEraseAction}
            onEditorSelectionChange={editor.handleEditorSelectionChange}
            onDeleteSelected={editor.handleDeleteSelected}
            onRotateSelected={editor.handleRotateSelected}
            onDragMove={editor.handleDragMove}
            editorTick={editor.editorTick}
            zoom={editor.zoom}
            onZoomChange={editor.handleZoomChange}
            panRef={editor.panRef}
            hiddenAgentIds={hiddenAgentIds}
          />

          <ZoomControls zoom={editor.zoom} onZoomChange={editor.handleZoomChange} />

          {/* Vignette overlay */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'var(--pixel-vignette)',
              pointerEvents: 'none',
              zIndex: 40,
            }}
          />

          <BottomToolbar
            isEditMode={editor.isEditMode}
            onOpenClaude={editor.handleOpenClaude}
            onToggleEditMode={editor.handleToggleEditMode}
            isDebugMode={isDebugMode}
            onToggleDebugMode={handleToggleDebugMode}
            workspaceFolders={workspaceFolders}
          />

          {editor.isEditMode && editor.isDirty && (
            <EditActionBar editor={editor} editorState={editorState} />
          )}

          {!editor.isEditMode && (
            <ProjectFilterBar
              projects={projects}
              filter={projectFilter}
              onFilterChange={setProjectFilter}
            />
          )}

          {showRotateHint && (
            <div
              style={{
                position: 'absolute',
                top: editor.isDirty ? 52 : 8,
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 49,
                background: 'var(--pixel-hint-bg)',
                color: '#fff',
                fontSize: '12px',
                padding: '3px 8px',
                borderRadius: 0,
                border: '2px solid var(--pixel-accent)',
                boxShadow: 'var(--pixel-shadow)',
                pointerEvents: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              Rotate (R)
            </div>
          )}

          {editor.isEditMode &&
            (() => {
              // Compute selected furniture color from current layout
              const selUid = editorState.selectedFurnitureUid;
              const selColor = selUid
                ? (officeState.getLayout().furniture.find((f) => f.uid === selUid)?.color ?? null)
                : null;
              return (
                <EditorToolbar
                  activeTool={editorState.activeTool}
                  selectedTileType={editorState.selectedTileType}
                  selectedFurnitureType={editorState.selectedFurnitureType}
                  selectedFurnitureUid={selUid}
                  selectedFurnitureColor={selColor}
                  floorColor={editorState.floorColor}
                  wallColor={editorState.wallColor}
                  selectedWallSet={editorState.selectedWallSet}
                  onToolChange={editor.handleToolChange}
                  onTileTypeChange={editor.handleTileTypeChange}
                  onFloorColorChange={editor.handleFloorColorChange}
                  onWallColorChange={editor.handleWallColorChange}
                  onWallSetChange={editor.handleWallSetChange}
                  onSelectedFurnitureColorChange={editor.handleSelectedFurnitureColorChange}
                  onFurnitureTypeChange={editor.handleFurnitureTypeChange}
                  loadedAssets={loadedAssets}
                />
              );
            })()}

          {
            <ToolOverlay
              officeState={officeState}
              agents={visibleAgents}
              agentTools={agentTools}
              subagentCharacters={subagentCharacters}
              containerRef={containerRef}
              zoom={editor.zoom}
              panRef={editor.panRef}
              onCloseAgent={handleCloseAgent}
            />
          }

          {showMigrationNotice && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: 'rgba(0, 0, 0, 0.7)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 100,
              }}
              onClick={() => setMigrationNoticeDismissed(true)}
            >
              <div
                style={{
                  background: 'var(--pixel-bg)',
                  border: '2px solid var(--pixel-border)',
                  borderRadius: 0,
                  padding: '24px 32px',
                  maxWidth: 620,
                  boxShadow: 'var(--pixel-shadow)',
                  textAlign: 'center',
                  lineHeight: 1.3,
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{ fontSize: '24px', marginBottom: 12, color: 'var(--pixel-accent)' }}>
                  We owe you an apology!
                </div>
                <p style={{ fontSize: '14px', color: 'var(--pixel-text)', margin: '0 0 12px 0' }}>
                  We've just migrated to fully open-source assets, all built from scratch with love.
                  Unfortunately, this means your previous layout had to be reset.
                </p>
                <p style={{ fontSize: '14px', color: 'var(--pixel-text)', margin: '0 0 12px 0' }}>
                  We're really sorry about that.
                </p>
                <p style={{ fontSize: '14px', color: 'var(--pixel-text)', margin: '0 0 12px 0' }}>
                  The good news? This was a one-time thing, and it paves the way for some genuinely
                  exciting updates ahead.
                </p>
                <p
                  style={{ fontSize: '14px', color: 'var(--pixel-text-dim)', margin: '0 0 20px 0' }}
                >
                  Stay tuned, and thanks for using Pixel Agents!
                </p>
                <button
                  className="pixel-agents-migration-btn"
                  style={{
                    padding: '6px 24px 8px',
                    fontSize: '16px',
                    background: 'var(--pixel-accent)',
                    color: '#fff',
                    border: '2px solid var(--pixel-accent)',
                    borderRadius: 0,
                    cursor: 'pointer',
                    boxShadow: 'var(--pixel-shadow)',
                  }}
                  onClick={() => setMigrationNoticeDismissed(true)}
                >
                  Got it
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Debug panel — right or bottom, resizable */}
        {isDebugMode && (
          <>
            {/* Resize handle */}
            <div
              onMouseDown={handleResizeStart}
              style={{
                flexShrink: 0,
                background: 'transparent',
                ...(debugPosition === 'right'
                  ? { width: 4, cursor: 'col-resize' }
                  : { height: 4, cursor: 'row-resize' }),
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = 'var(--pixel-accent)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = 'transparent';
              }}
            />
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                flexShrink: 0,
                overflow: 'hidden',
                ...(debugPosition === 'right'
                  ? { width: debugPanelWidth, maxHeight: '100%' }
                  : { height: debugPanelHeight, width: '100%' }),
              }}
            >
              {/* Status bar */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '4px 8px',
                  background: 'var(--pixel-bg)',
                  borderBottom: '1px solid var(--pixel-border)',
                  flexShrink: 0,
                }}
              >
                <span style={{ fontSize: '11px', color: 'var(--pixel-text-dim)' }}>디버그</span>
                <span style={{ display: 'flex', gap: 2 }}>
                  <button
                    onClick={() => handleDebugPositionChange('right')}
                    title="우측 배치"
                    style={{
                      width: 18,
                      height: 18,
                      border:
                        debugPosition === 'right'
                          ? '1px solid var(--pixel-accent)'
                          : '1px solid var(--pixel-border)',
                      borderRadius: 0,
                      background:
                        debugPosition === 'right' ? 'var(--pixel-active-bg)' : 'transparent',
                      color: 'var(--pixel-text)',
                      cursor: 'pointer',
                      fontSize: '10px',
                      lineHeight: 1,
                      padding: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    ▐
                  </button>
                  <button
                    onClick={() => handleDebugPositionChange('bottom')}
                    title="하단 배치"
                    style={{
                      width: 18,
                      height: 18,
                      border:
                        debugPosition === 'bottom'
                          ? '1px solid var(--pixel-accent)'
                          : '1px solid var(--pixel-border)',
                      borderRadius: 0,
                      background:
                        debugPosition === 'bottom' ? 'var(--pixel-active-bg)' : 'transparent',
                      color: 'var(--pixel-text)',
                      cursor: 'pointer',
                      fontSize: '10px',
                      lineHeight: 1,
                      padding: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    ▄
                  </button>
                  <button
                    onClick={handleToggleDebugMode}
                    title="패널 닫기"
                    style={{
                      width: 18,
                      height: 18,
                      border: '1px solid var(--pixel-border)',
                      borderRadius: 0,
                      background: 'transparent',
                      color: 'var(--pixel-text)',
                      cursor: 'pointer',
                      fontSize: '10px',
                      lineHeight: 1,
                      padding: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginLeft: 2,
                    }}
                  >
                    ✕
                  </button>
                </span>
              </div>
              {/* Scrollable content */}
              <div style={{ flex: 1, overflow: 'auto' }}>
                <DebugView
                  agents={visibleAgents}
                  selectedAgent={selectedAgent}
                  agentTools={agentTools}
                  agentStatuses={agentStatuses}
                  subagentTools={subagentTools}
                  onSelectAgent={handleSelectAgent}
                  officeState={officeState}
                />
              </div>
            </div>
          </>
        )}
      </div>
      <UsageStatusBar
        agents={visibleAgents}
        selectedAgent={selectedAgent}
        agentUsage={agentUsage}
      />
    </div>
  );
}

export default App;
