'use strict';
// Local preview server. The game itself is plain static files in docs/ (that's
// what GitHub Pages serves). Phones connect to each other directly, so this
// server only hands out files.

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, 'docs');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  const file = path.normalize(path.join(ROOT, pathname.endsWith('/') ? pathname + 'index.html' : pathname));
  if (!file.startsWith(ROOT + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, () => console.log(`Kart Clash preview at http://localhost:${port}`));
