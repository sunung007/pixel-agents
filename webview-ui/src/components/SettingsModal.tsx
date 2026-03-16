import { useEffect, useRef, useState } from 'react';

import { getCssVarValue, loadSavedColors, saveCssColors, STORAGE_KEY } from '../cssColors.js';
import { isSoundEnabled, setSoundEnabled } from '../notificationSound.js';
import { isStandalone, vscode } from '../vscodeApi.js';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  isDebugMode: boolean;
  onToggleDebugMode: () => void;
}

const menuItemBase: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  width: '100%',
  padding: '5px 10px',
  fontSize: '14px',
  color: 'rgba(255, 255, 255, 0.8)',
  background: 'transparent',
  border: 'none',
  borderRadius: 0,
  cursor: 'pointer',
  textAlign: 'left',
};

const COLOR_VARS = [
  { key: '--pixel-canvas-bg', label: '캔버스 배경' },
  { key: '--pixel-bg', label: 'UI 배경' },
  { key: '--pixel-border', label: '테두리' },
  { key: '--pixel-accent', label: '강조색' },
  { key: '--pixel-green', label: '에이전트 버튼' },
  { key: '--pixel-debug-text', label: '디버그/대기 글자' },
] as const;

export function SettingsModal({
  isOpen,
  onClose,
  isDebugMode,
  onToggleDebugMode,
}: SettingsModalProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [soundLocal, setSoundLocal] = useState(isSoundEnabled);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [showColors, setShowColors] = useState(false);
  const [colors, setColors] = useState<Record<string, string>>({});
  const [debugFontSize, setDebugFontSize] = useState(12);

  useEffect(() => {
    if (isOpen) {
      const saved = loadSavedColors();
      const current: Record<string, string> = {};
      for (const { key } of COLOR_VARS) {
        current[key] = saved[key] || getCssVarValue(key);
      }
      setColors(current);
      // Load font size
      const savedSize =
        saved['--pixel-debug-font-size'] || getCssVarValue('--pixel-debug-font-size');
      setDebugFontSize(parseInt(savedSize, 10) || 12);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleColorChange = (varName: string, value: string) => {
    setColors((prev) => ({ ...prev, [varName]: value }));
    document.documentElement.style.setProperty(varName, value);
    const updated = { ...loadSavedColors(), [varName]: value };
    saveCssColors(updated);
  };

  const handleResetColors = () => {
    localStorage.removeItem(STORAGE_KEY);
    const root = document.documentElement;
    for (const { key } of COLOR_VARS) {
      root.style.removeProperty(key);
    }
    root.style.removeProperty('--pixel-debug-font-size');
    const fresh: Record<string, string> = {};
    for (const { key } of COLOR_VARS) {
      fresh[key] = getCssVarValue(key);
    }
    setColors(fresh);
    setDebugFontSize(12);
  };

  const handleExport = () => {
    if (isStandalone) {
      vscode.postMessage({ type: 'exportLayout' });
      onClose();
    } else {
      vscode.postMessage({ type: 'exportLayout' });
      onClose();
    }
  };

  const handleImport = () => {
    if (isStandalone) {
      importInputRef.current?.click();
    } else {
      vscode.postMessage({ type: 'importLayout' });
      onClose();
    }
  };

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(reader.result as string);
        if (imported.version !== 1 || !Array.isArray(imported.tiles)) {
          alert('올바르지 않은 레이아웃 파일입니다.');
          return;
        }
        vscode.postMessage({ type: 'saveLayout', layout: imported });
        window.dispatchEvent(
          new MessageEvent('message', { data: { type: 'layoutLoaded', layout: imported } }),
        );
        onClose();
      } catch {
        alert('레이아웃 파일을 읽는 데 실패했습니다.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <>
      {/* Dark backdrop — click to close */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: 'rgba(0, 0, 0, 0.5)',
          zIndex: 49,
        }}
      />
      {/* Centered modal */}
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 50,
          background: 'var(--pixel-bg)',
          border: '2px solid var(--pixel-border)',
          borderRadius: 0,
          padding: '4px',
          boxShadow: 'var(--pixel-shadow)',
          minWidth: 240,
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '4px 10px',
            borderBottom: '1px solid var(--pixel-border)',
            marginBottom: '4px',
          }}
        >
          <span style={{ fontSize: '14px', color: 'rgba(255, 255, 255, 0.9)' }}>설정</span>
          <button
            onClick={onClose}
            onMouseEnter={() => setHovered('close')}
            onMouseLeave={() => setHovered(null)}
            style={{
              background: hovered === 'close' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
              border: 'none',
              borderRadius: 0,
              color: 'rgba(255, 255, 255, 0.6)',
              fontSize: '14px',
              cursor: 'pointer',
              padding: '0 4px',
              lineHeight: 1,
            }}
          >
            X
          </button>
        </div>
        {/* Menu items */}
        <button
          onClick={() => {
            vscode.postMessage({ type: 'openSessionsFolder' });
            onClose();
          }}
          onMouseEnter={() => setHovered('sessions')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'sessions' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          }}
        >
          세션 폴더 열기
        </button>
        <button
          onClick={handleExport}
          onMouseEnter={() => setHovered('export')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'export' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          }}
        >
          레이아웃 내보내기
        </button>
        <button
          onClick={handleImport}
          onMouseEnter={() => setHovered('import')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'import' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          }}
        >
          레이아웃 가져오기
        </button>
        {isStandalone && (
          <input
            ref={importInputRef}
            type="file"
            accept=".json"
            style={{ display: 'none' }}
            onChange={handleFileSelected}
          />
        )}
        <button
          onClick={() => {
            const newVal = !isSoundEnabled();
            setSoundEnabled(newVal);
            setSoundLocal(newVal);
            vscode.postMessage({ type: 'setSoundEnabled', enabled: newVal });
          }}
          onMouseEnter={() => setHovered('sound')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'sound' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          }}
        >
          <span>알림 소리</span>
          <span
            style={{
              width: 14,
              height: 14,
              border: '2px solid rgba(255, 255, 255, 0.5)',
              borderRadius: 0,
              background: soundLocal ? 'rgba(90, 140, 255, 0.8)' : 'transparent',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '12px',
              lineHeight: 1,
              color: '#fff',
            }}
          >
            {soundLocal ? 'X' : ''}
          </span>
        </button>
        {/* Color settings */}
        <button
          onClick={() => setShowColors((v) => !v)}
          onMouseEnter={() => setHovered('colors')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'colors' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          }}
        >
          <span>UI 설정</span>
          <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}>
            {showColors ? '▲' : '▼'}
          </span>
        </button>
        {showColors && (
          <div style={{ padding: '6px 10px' }}>
            {COLOR_VARS.map(({ key, label }) => (
              <div
                key={key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 6,
                }}
              >
                <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.7)' }}>{label}</span>
                <input
                  type="color"
                  value={colors[key] || '#000000'}
                  onChange={(e) => handleColorChange(key, e.target.value)}
                  style={{
                    width: 28,
                    height: 22,
                    border: '2px solid var(--pixel-border)',
                    borderRadius: 0,
                    padding: 0,
                    cursor: 'pointer',
                    background: 'transparent',
                  }}
                />
              </div>
            ))}
            {/* Debug font size +/- */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 6,
                marginTop: 4,
              }}
            >
              <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.7)' }}>
                디버그 글자 크기
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <button
                  onClick={() => {
                    const next = Math.max(8, debugFontSize - 1);
                    setDebugFontSize(next);
                    document.documentElement.style.setProperty(
                      '--pixel-debug-font-size',
                      `${next}px`,
                    );
                    const updated = {
                      ...loadSavedColors(),
                      '--pixel-debug-font-size': `${next}px`,
                    };
                    saveCssColors(updated);
                  }}
                  style={{
                    width: 22,
                    height: 22,
                    border: '2px solid var(--pixel-border)',
                    borderRadius: 0,
                    background: 'var(--pixel-btn-bg)',
                    color: 'var(--pixel-text)',
                    cursor: 'pointer',
                    fontSize: '14px',
                    lineHeight: 1,
                    padding: 0,
                  }}
                >
                  -
                </button>
                <span
                  style={{
                    fontSize: '13px',
                    color: 'rgba(255,255,255,0.8)',
                    minWidth: 30,
                    textAlign: 'center',
                  }}
                >
                  {debugFontSize}px
                </span>
                <button
                  onClick={() => {
                    const next = Math.min(20, debugFontSize + 1);
                    setDebugFontSize(next);
                    document.documentElement.style.setProperty(
                      '--pixel-debug-font-size',
                      `${next}px`,
                    );
                    const updated = {
                      ...loadSavedColors(),
                      '--pixel-debug-font-size': `${next}px`,
                    };
                    saveCssColors(updated);
                  }}
                  style={{
                    width: 22,
                    height: 22,
                    border: '2px solid var(--pixel-border)',
                    borderRadius: 0,
                    background: 'var(--pixel-btn-bg)',
                    color: 'var(--pixel-text)',
                    cursor: 'pointer',
                    fontSize: '14px',
                    lineHeight: 1,
                    padding: 0,
                  }}
                >
                  +
                </button>
              </span>
            </div>
            <button
              onClick={handleResetColors}
              onMouseEnter={() => setHovered('resetColors')}
              onMouseLeave={() => setHovered(null)}
              style={{
                width: '100%',
                padding: '4px 8px',
                fontSize: '12px',
                color: 'var(--pixel-reset-text)',
                background: hovered === 'resetColors' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                border: '1px solid var(--pixel-border)',
                borderRadius: 0,
                cursor: 'pointer',
                marginTop: 2,
              }}
            >
              기본값으로 초기화
            </button>
          </div>
        )}
        <button
          onClick={onToggleDebugMode}
          onMouseEnter={() => setHovered('debug')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'debug' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          }}
        >
          <span>디버그 보기</span>
          {isDebugMode && (
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'rgba(90, 140, 255, 0.8)',
                flexShrink: 0,
              }}
            />
          )}
        </button>
      </div>
    </>
  );
}
