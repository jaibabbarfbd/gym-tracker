// Tiny static server, no dependencies: `node server.js` then open http://localhost:5173
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');

const PORT = Number(process.env.PORT) || 5173;
const ROOT = __dirname;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

http
  .createServer((req, res) => {
    let urlPath;
    try {
      urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      res.writeHead(400);
      return res.end();
    }
    let file = path.join(ROOT, urlPath);
    if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
      res.writeHead(403);
      return res.end();
    }
    if (urlPath.endsWith('/')) file = path.join(file, 'index.html');
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('Not found');
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  })
  .listen(PORT, () => {
    const url = `http://localhost:${PORT}`;
    console.log(`Gym Tracker is running at ${url}`);
    const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal);
    if (lan) console.log(`On your phone (same Wi-Fi): http://${lan.address}:${PORT}  (no notifications over plain http; see README)`);
    console.log('Press Ctrl+C to stop.');
    if (process.argv.includes('--open')) exec(process.platform === 'win32' ? `start "" ${url}` : `open ${url}`);
  });
