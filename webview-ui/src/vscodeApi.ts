interface VsCodeApi {
  postMessage(msg: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

declare global {
  interface Window {
    __PIXEL_AGENTS_STANDALONE__?: boolean;
    __PIXEL_AGENTS_WS_URL__?: string;
  }
}

export const isStandalone =
  typeof window !== 'undefined' && window.__PIXEL_AGENTS_STANDALONE__ === true;

const api: VsCodeApi = isStandalone
  ? { postMessage: () => {} } // Replaced by wsAdapter at runtime
  : acquireVsCodeApi();

export const vscode = api;

/** Replace the postMessage implementation (used by wsAdapter) */
export function setMessageSink(sink: VsCodeApi): void {
  vscode.postMessage = sink.postMessage.bind(sink);
}
