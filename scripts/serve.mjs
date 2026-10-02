// Minimal static server for previewing dist/.  npm run serve  ->  http://localhost:8080
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

const DIST = path.resolve(import.meta.dirname, '..', process.env.DIR || 'dist');
const PORT = Number(process.env.PORT) || 8080;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.avif': 'image/avif', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm' };

http.createServer(async (req, res) => {
  let p = path.join(DIST, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(DIST)) { res.writeHead(403).end(); return; }
  try {
    if ((await fs.stat(p)).isDirectory()) p = path.join(p, 'index.html');
    const body = await fs.readFile(p);
    const ext = path.extname(p);
    const head = { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000', 'Accept-Ranges': 'bytes' };
    // Byte ranges, so videos can seek and loop like they do on a real host.
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (m) {
      const start = m[1] ? Number(m[1]) : body.length - Number(m[2]);
      const end = m[1] && m[2] ? Math.min(Number(m[2]), body.length - 1) : body.length - 1;
      res.writeHead(206, { ...head, 'Content-Range': `bytes ${start}-${end}/${body.length}`, 'Content-Length': end - start + 1 });
      res.end(body.subarray(start, end + 1));
      return;
    }
    res.writeHead(200, head);
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': TYPES['.html'] }).end(await fs.readFile(path.join(DIST, '404.html')).catch(() => 'Not found'));
  }
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));
