import type http from 'http';
import type { ServerOptions, WebSocket } from 'ws';
import { WebSocketServer } from 'ws';

import type { MessageSink } from '../shared/messageSink.js';

export interface WsBroadcaster extends MessageSink {
  /** Send to all connected clients */
  postMessage(message: unknown): void;
  /** Send to a specific client */
  sendTo(ws: WebSocket, message: unknown): void;
  /** Number of connected clients */
  clientCount(): number;
}

export function createWsServer(
  server: http.Server,
  onClientReady: (ws: WebSocket) => void,
  onClientMessage: (ws: WebSocket, message: Record<string, unknown>) => void,
): WsBroadcaster {
  const wss = new WebSocketServer({ server } as ServerOptions);
  const clients = new Set<WebSocket>();

  wss.on('connection', (ws: WebSocket) => {
    clients.add(ws);
    console.log(`[Pixel Agents Server] WebSocket client connected (${clients.size} total)`);

    ws.on('message', (data: Buffer | string) => {
      try {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        if (msg.type === 'webviewReady') {
          onClientReady(ws);
        } else {
          onClientMessage(ws, msg);
        }
      } catch {
        /* ignore malformed messages */
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      console.log(
        `[Pixel Agents Server] WebSocket client disconnected (${clients.size} remaining)`,
      );
    });

    ws.on('error', () => {
      clients.delete(ws);
    });
  });

  const broadcaster: WsBroadcaster = {
    postMessage(message: unknown): void {
      const json = JSON.stringify(message);
      for (const client of clients) {
        if (client.readyState === 1 /* OPEN */) {
          client.send(json);
        }
      }
    },
    sendTo(ws: WebSocket, message: unknown): void {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify(message));
      }
    },
    clientCount(): number {
      return clients.size;
    },
  };

  return broadcaster;
}
