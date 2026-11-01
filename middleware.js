// Guardia de acceso: corre antes de CUALQUIER request (páginas y API). Sin una
// cookie de sesión válida, redirige al login. Declarado explícitamente como
// proxy.entrypoint en vercel.json (en vez de confiar en que Vercel detecte este
// archivo solo por su nombre) — esa clave solo acepta .js/.ts/.py, así que va con
// esta extensión aunque el resto del proyecto sea CommonJS; Vercel empaqueta este
// entrypoint con su propio build, así que el import/export de acá adentro sí corre.
import crypto from 'node:crypto';
import { next } from '@vercel/functions';

function leerCookie(request, nombre) {
  const encabezado = request.headers.get('cookie') || '';
  for (const parte of encabezado.split(';')) {
    const igual = parte.indexOf('=');
    if (igual === -1) continue;
    if (parte.slice(0, igual).trim() === nombre) return parte.slice(igual + 1).trim();
  }
  return null;
}

function verificar(cookieValor, secreto) {
  if (!cookieValor) return false;
  const punto = cookieValor.lastIndexOf('.');
  if (punto === -1) return false;
  const payload = cookieValor.slice(0, punto);
  const firma = cookieValor.slice(punto + 1);
  const firmaEsperada = crypto.createHmac('sha256', secreto).update(payload).digest('base64url');
  if (firmaEsperada.length !== firma.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(firmaEsperada), Buffer.from(firma))) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof exp === 'number' && Date.now() < exp;
  } catch {
    return false;
  }
}

export default function middleware(request) {
  const url = new URL(request.url);

  // El login y la ruta que lo procesa quedan fuera del guardia (si no, nadie
  // podría ni siquiera cargar el formulario para iniciar sesión).
  if (url.pathname === '/login.html' || url.pathname === '/api/login') {
    return next();
  }

  // Mismo fallback de nombre que api/login.js — tienen que resolver al mismo
  // valor, si no la firma de la cookie nunca va a coincidir.
  const secreto = process.env.SESSION_SECRET || process.env.SESSIONSECRET;
  const cookie = leerCookie(request, 'sesion');
  if (secreto && verificar(cookie, secreto)) {
    return next();
  }

  return Response.redirect(new URL('/login.html', request.url));
}

export const config = { runtime: 'nodejs' };
