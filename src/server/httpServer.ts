import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
};

export function createHttpServer(
  webviewDir: string,
  wsUrl: string,
  options?: { electron?: boolean },
): http.Server {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    let filePath: string;

    if (url.pathname === '/' || url.pathname === '/index.html') {
      // Serve index.html with standalone flag injected
      filePath = path.join(webviewDir, 'index.html');
      try {
        let html = fs.readFileSync(filePath, 'utf-8');
        // Inject standalone config before closing </head>
        const electronFlag = options?.electron ? 'window.__PIXEL_AGENTS_ELECTRON__=true;' : '';
        const script = `<script>window.__PIXEL_AGENTS_STANDALONE__=true;${electronFlag}window.__PIXEL_AGENTS_WS_URL__="${wsUrl}";</script>`;
        html = html.replace('</head>', `${script}\n</head>`);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } catch {
        res.writeHead(404);
        res.end('Not found');
      }
      return;
    }

    // Serve static files
    filePath = path.join(webviewDir, url.pathname);

    // Security: prevent path traversal
    if (!filePath.startsWith(webviewDir)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    try {
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const content = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    } catch {
      res.writeHead(500);
      res.end('Internal server error');
    }
  });

  return server;
}
