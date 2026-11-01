const crypto = require('node:crypto');

const NOVENTA_DIAS_SEG = 90 * 24 * 60 * 60;

function firmar(payload, secreto) {
  return crypto.createHmac('sha256', secreto).update(payload).digest('base64url');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido' });
    return;
  }

  // Acepta también los nombres sin guion bajo, por si la variable quedó cargada
  // así en Vercel (APPpasword / SESSIONSECRET) — evita depender de renombrarla ahí.
  const esperado = process.env.APP_PASSWORD || process.env.APPPASSWORD || process.env.APPpasword;
  const secreto = process.env.SESSION_SECRET || process.env.SESSIONSECRET;
  if (!esperado || !secreto) {
    res.status(500).json({ error: 'Falta configurar APP_PASSWORD y SESSION_SECRET en las variables de entorno de Vercel' });
    return;
  }

  const password = (req.body && req.body.password) || '';
  const coincide = typeof password === 'string'
    && password.length === esperado.length
    && crypto.timingSafeEqual(Buffer.from(password), Buffer.from(esperado));

  if (!coincide) {
    res.status(401).json({ error: 'Contraseña incorrecta' });
    return;
  }

  const exp = Date.now() + NOVENTA_DIAS_SEG * 1000;
  const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
  const cookie = `${payload}.${firmar(payload, secreto)}`;

  res.setHeader(
    'Set-Cookie',
    `sesion=${cookie}; Path=/; Max-Age=${NOVENTA_DIAS_SEG}; HttpOnly; Secure; SameSite=Strict`
  );
  res.status(200).json({ ok: true });
};
