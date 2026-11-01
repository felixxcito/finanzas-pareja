// Función única para toda la API — vercel.json reescribe /api/* hacia acá
// explícitamente (en vez de confiar en la convención de archivo [...path].js,
// que en este proyecto sin framework no estaba agarrando rutas de más de un
// segmento como /api/deudas/1/pagos).
//
// No sabemos con certeza si Vercel, al reescribir, deja req.url con la ruta
// ORIGINAL o con la de destino (/api/handler) — así que se prueban las dos:
// primero el query param explícito que manda el rewrite (?vercelPath=...),
// y si no viene, se usa el pathname tal cual llegó.
const { URL } = require('node:url');
const { handleApi } = require('../server/api');

module.exports = async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  const query = Object.fromEntries(url.searchParams.entries());
  const { vercelPath, ...restoQuery } = query;
  const pathname = vercelPath !== undefined ? '/api/' + vercelPath : url.pathname;
  await handleApi(req, res, pathname, restoQuery);
};
