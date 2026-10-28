import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

const envPath = path.join(root, '.env.local');
if (fs.existsSync(envPath)) {
  for (const linea of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const l = linea.trim();
    if (!l || l.startsWith('#')) continue;
    const i = l.indexOf('=');
    if (i === -1) continue;
    const k = l.slice(0, i).trim();
    let v = l.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

function readBody(req, limite = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limite) {
        reject(new Error('Archivo demasiado grande.'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function respuesta(res) {
  let status = 200;
  return {
    status(code) {
      status = code;
      return this;
    },
    json(obj) {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      res.end(JSON.stringify(obj));
    },
    setHeader(k, v) {
      res.setHeader(k, v);
      return this;
    },
    end() {
      res.end();
    }
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/api/extraer') {
    try {
      let body = {};
      if (req.method === 'POST') {
        const raw = await readBody(req);
        if (raw.length) {
          try {
            body = JSON.parse(raw.toString('utf8'));
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: false, error: 'Cuerpo de la petición inválido.' }));
            return;
          }
        }
      }
      const { default: handler } = await import('./api/extraer.mjs');
      await handler({ method: req.method, body, headers: req.headers }, respuesta(res));
    } catch (err) {
      console.error('Error en /api/extraer:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'Error interno: ' + (err.message || err) }));
      }
    }
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'Ruta no encontrada.' }));
    return;
  }

  let archivo = decodeURIComponent(url.pathname);
  if (archivo === '/') archivo = '/index.html';
  if (archivo.includes('..')) {
    res.writeHead(403);
    res.end('Prohibido');
    return;
  }

  const filePath = path.join(root, archivo);
  if (!filePath.startsWith(root + path.sep)) {
    res.writeHead(403);
    res.end('Prohibido');
    return;
  }

  const base = path.basename(filePath);
  if (
    base.startsWith('.env') ||
    base === 'server.js' ||
    base === 'package.json' ||
    base === 'package-lock.json'
  ) {
    res.writeHead(404);
    res.end('No encontrado');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('No encontrado');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`App local: http://localhost:${PORT}`);
  if (!process.env.GEMINI_API_KEY) {
    console.log('Aviso: GEMINI_API_KEY está vacía en .env.local.');
  }
});
