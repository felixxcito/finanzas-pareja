const crypto = require('node:crypto');
const { put, get: obtenerBlob, del } = require('@vercel/blob');
const { get, all, run } = require('./db');

const MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
// 2.5MB ya decodificados: en base64 son ~3.3MB, dejando margen bajo el límite de
// 4.5MB que Vercel le pone al body completo de una función.
const MAX_BYTES = 2.5 * 1024 * 1024;

// Las fotos llegan como data URL (base64) dentro del JSON del POST — el navegador
// las redimensiona antes de mandarlas (ver public/js/app.js). Se guardan en un store
// PRIVADO de Vercel Blob (no una URL pública suelta): solo se pueden leer con el
// token del proyecto, a través de obtenerArchivo() más abajo.
async function guardarAdjunto({ entidad, entidad_id, nombre_original, data_url }) {
  if (!entidad || !entidad_id || !data_url) throw new Error('Faltan campos obligatorios (entidad, entidad_id, data_url)');
  const match = /^data:([^;]+);base64,(.+)$/.exec(data_url);
  if (!match) throw new Error('Formato de imagen inválido');
  const mime = match[1];
  const ext = MIME_EXT[mime];
  if (!ext) throw new Error('Solo se aceptan imágenes jpg, png o webp');
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length) throw new Error('Imagen vacía');
  if (buffer.length > MAX_BYTES) throw new Error('La imagen es muy pesada (máximo 2.5MB)');

  const nombreArchivo = `adjuntos/${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  const subido = await put(nombreArchivo, buffer, { access: 'private', contentType: mime });

  const info = await run(
    `INSERT INTO adjuntos (entidad, entidad_id, archivo, nombre_original, mime, bytes) VALUES (?,?,?,?,?,?)`,
    [entidad, entidad_id, subido.pathname, nombre_original || null, mime, buffer.length]
  );
  return get('SELECT * FROM adjuntos WHERE id=?', [info.lastInsertRowid]);
}

async function listarAdjuntos(entidad, entidadId) {
  return all('SELECT * FROM adjuntos WHERE entidad=? AND entidad_id=? ORDER BY id DESC', [entidad, entidadId]);
}

async function borrarAdjunto(id) {
  const a = await get('SELECT * FROM adjuntos WHERE id=?', [id]);
  if (!a) return;
  await run('DELETE FROM adjuntos WHERE id=?', [id]);
  try { await del(a.archivo); } catch { /* si ya no está en Blob, no pasa nada */ }
}

async function borrarAdjuntosDe(entidad, entidadId) {
  for (const a of await listarAdjuntos(entidad, entidadId)) await borrarAdjunto(a.id);
}

// Trae el archivo desde el store privado de Blob y lo devuelve como Buffer para que
// el router lo reenvíe — así las fotos quedan protegidas por el mismo login que el
// resto de la app, no solo por tener una URL que nadie adivina.
async function obtenerArchivo(id) {
  const a = await get('SELECT * FROM adjuntos WHERE id=?', [id]);
  if (!a) return null;
  const resultado = await obtenerBlob(a.archivo, { access: 'private' });
  if (!resultado || resultado.statusCode !== 200) return null;
  const buffer = Buffer.from(await new Response(resultado.stream).arrayBuffer());
  return { buffer, mime: a.mime };
}

module.exports = { guardarAdjunto, listarAdjuntos, borrarAdjunto, borrarAdjuntosDe, obtenerArchivo };
