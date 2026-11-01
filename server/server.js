const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { URL } = require('node:url');

// Carga .env a mano (sin dotenv): solo para correr local con `node server/server.js`.
// En Vercel las variables ya vienen puestas por la plataforma, así que esto no hace nada ahí.
(function cargarEnvLocal() {
  const rutaEnv = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(rutaEnv)) return;
  for (const linea of fs.readFileSync(rutaEnv, 'utf8').split('\n')) {
    const m = /^\s*([\w.-]+)\s*=\s*(.*)?\s*$/.exec(linea);
    if (!m) continue;
    const clave = m[1];
    let valor = (m[2] || '').trim();
    if (valor.startsWith('"') && valor.endsWith('"')) valor = valor.slice(1, -1);
    if (process.env[clave] === undefined) process.env[clave] = valor;
  }
})();

const { handleApi } = require('./api');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = process.env.PORT || 4173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function serveStatic(req, res, pathname) {
  let filePath = pathname === '/' ? '/index.html' : pathname;
  const fullPath = path.normalize(path.join(PUBLIC_DIR, filePath));
  if (!fullPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Prohibido');
    return;
  }
  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('No encontrado: ' + filePath);
      return;
    }
    const ext = path.extname(fullPath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const query = Object.fromEntries(url.searchParams.entries());

  if (url.pathname.startsWith('/api/')) {
    const handled = await handleApi(req, res, url.pathname, query);
    if (handled) return;
  }

  if (req.method === 'GET') {
    serveStatic(req, res, url.pathname);
  } else {
    res.writeHead(404);
    res.end();
  }
});

function ipsLocales() {
  const ifaces = os.networkInterfaces();
  const ips = [];
  for (const nombre of Object.keys(ifaces)) {
    for (const iface of ifaces[nombre]) {
      if (iface.family === 'IPv4' && !iface.internal) ips.push(iface.address);
    }
  }
  return ips;
}

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  💗 Finanzas en pareja — servidor local corriendo 💗');
  console.log('');
  console.log(`  En este equipo:     http://localhost:${PORT}`);
  for (const ip of ipsLocales()) {
    console.log(`  Desde el celular:   http://${ip}:${PORT}   (misma wifi)`);
  }
  console.log('');
  console.log('  Para apagarlo: Ctrl + C en esta ventana.');
  console.log('');
});
