import { setMessageSink } from './vscodeApi.ts';

let ws: WebSocket | null = null;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 30000;

export function initWebSocket(): void {
  const wsUrl = window.__PIXEL_AGENTS_WS_URL__;
  if (!wsUrl) {
    console.warn('[wsAdapter] No WS URL configured');
    return;
  }

  connect(wsUrl);
}

function connect(wsUrl: string): void {
  const socket = new WebSocket(wsUrl);
  ws = socket;

  socket.onopen = () => {
    console.log('[wsAdapter] Connected to server');
    reconnectDelay = 1000;

    // Wire up outgoing messages
    setMessageSink({
      postMessage(msg: unknown): void {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(msg));
        }
      },
    });

    // Send webviewReady to trigger server initialization
    socket.send(JSON.stringify({ type: 'webviewReady' }));
  };

  socket.onmessage = (event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data as string);
      // Dispatch as a MessageEvent on window, matching VS Code webview pattern.
      // useExtensionMessages.ts listens for window 'message' events with event.data.type
      window.dispatchEvent(new MessageEvent('message', { data }));
    } catch {
      /* ignore malformed messages */
    }
  };

  socket.onclose = () => {
    console.log(`[wsAdapter] Disconnected, reconnecting in ${reconnectDelay}ms...`);
    ws = null;
    setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
      connect(wsUrl);
    }, reconnectDelay);
  };

  socket.onerror = () => {
    // onclose will fire after this
  };
}
