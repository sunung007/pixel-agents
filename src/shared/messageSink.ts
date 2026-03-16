/**
 * Minimal interface for sending messages to a webview or WebSocket client.
 * vscode.Webview satisfies this interface, so the VS Code extension
 * works without changes.
 */
export interface MessageSink {
  postMessage(message: unknown): void;
}
