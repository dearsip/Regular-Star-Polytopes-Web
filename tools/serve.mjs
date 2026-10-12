import http from 'node:http';
import { stat, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const port = portIndex < 0 ? 8080 : Number(args[portIndex + 1]);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)), args.includes('--dist') ? 'dist' : '.');
const prefixIndex = args.indexOf('--prefix');
const prefix = prefixIndex < 0 ? '/' : '/' + args[prefixIndex + 1].replace(/^\/+|\/+$/g, '') + '/';
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.gz': 'application/octet-stream', '.md': 'text/plain; charset=utf-8' };
http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    if (!pathname.startsWith(prefix)) { response.writeHead(404); response.end(); return; }
    let target = path.resolve(root, pathname.slice(prefix.length));
    if (target !== root && !target.startsWith(root + path.sep)) { response.writeHead(403); response.end(); return; }
    if ((await stat(target)).isDirectory()) target = path.join(target, 'index.html');
    const data = await readFile(target);
    response.writeHead(200, { 'Content-Type': types[path.extname(target)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    response.end(request.method === 'HEAD' ? undefined : data);
  } catch { response.writeHead(404); response.end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}${prefix}`));
