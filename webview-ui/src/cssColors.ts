export const STORAGE_KEY = 'pixel-agents-colors';

export function loadSavedColors(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return {};
}

export function saveCssColors(colors: Record<string, string>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(colors));
}

export function applyCssColors(colors: Record<string, string>): void {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(colors)) {
    root.style.setProperty(key, value);
  }
}

export function getCssVarValue(varName: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
}

export function initSavedColors(): void {
  const saved = loadSavedColors();
  if (Object.keys(saved).length > 0) {
    applyCssColors(saved);
  }
}
