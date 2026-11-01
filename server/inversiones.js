const { get, all, run } = require('./db');
const { obtenerTasas, resolverTasa, convertirAUsd } = require('./rates');

// "negocio" (ej. la tienda): capital metido + costos + retornos/ventas; el valor
// NO sube solo, lo actualizan a mano. "fondo": aportes y retiros hacia una meta.
// Es solo registro de lo que ellos cargan — nunca proyecta rendimientos.
async function resumenInversion(inv) {
  const movimientos = await all('SELECT * FROM movimientos_inversion WHERE inversion_id=? ORDER BY fecha DESC, id DESC', [inv.id]);
  const suma = (tipo) => movimientos.filter((m) => m.tipo === tipo).reduce((a, m) => a + m.monto_usd, 0);
  const aportes = suma('aporte');
  const retornos = suma('retorno');
  const costos = suma('costo');

  if (inv.tipo === 'negocio') {
    const ganancia_neta = retornos - aportes - costos;
    return {
      ...inv, movimientos, aportes, retornos, costos, ganancia_neta,
      progreso: inv.meta_monto_usd ? ganancia_neta / inv.meta_monto_usd : null
    };
  }
  const acumulado = aportes - retornos;
  return {
    ...inv, movimientos, aportes, retornos, costos, acumulado,
    progreso: inv.meta_monto_usd ? acumulado / inv.meta_monto_usd : null
  };
}

async function crearInversion(body) {
  const { nombre, tipo, meta_monto_usd, meta_fecha, nota } = body;
  if (!nombre || !tipo) throw new Error('Faltan campos obligatorios (nombre, tipo)');
  if (!['negocio', 'fondo'].includes(tipo)) throw new Error('Tipo inválido (usa negocio o fondo)');
  const info = await run(
    `INSERT INTO inversiones (nombre, tipo, meta_monto_usd, meta_fecha, nota) VALUES (?,?,?,?,?)`,
    [nombre, tipo, meta_monto_usd != null && meta_monto_usd !== '' ? Number(meta_monto_usd) : null, meta_fecha || null, nota || null]
  );
  return resumenInversion(await get('SELECT * FROM inversiones WHERE id=?', [info.lastInsertRowid]));
}

async function listarInversiones() {
  const inversiones = await all('SELECT * FROM inversiones ORDER BY activa DESC, creado_en DESC');
  return Promise.all(inversiones.map(resumenInversion));
}

async function obtenerInversion(id) {
  const inv = await get('SELECT * FROM inversiones WHERE id=?', [id]);
  if (!inv) throw new Error('Inversión no encontrada');
  return resumenInversion(inv);
}

async function actualizarInversion(id, body) {
  const inv = await get('SELECT * FROM inversiones WHERE id=?', [id]);
  if (!inv) throw new Error('Inversión no encontrada');
  const nombre = body.nombre ?? inv.nombre;
  const meta_monto_usd = body.meta_monto_usd !== undefined ? (body.meta_monto_usd != null && body.meta_monto_usd !== '' ? Number(body.meta_monto_usd) : null) : inv.meta_monto_usd;
  const meta_fecha = body.meta_fecha !== undefined ? (body.meta_fecha || null) : inv.meta_fecha;
  const nota = body.nota !== undefined ? body.nota : inv.nota;
  const activa = body.activa !== undefined ? (body.activa ? 1 : 0) : inv.activa;
  await run(
    'UPDATE inversiones SET nombre=?, meta_monto_usd=?, meta_fecha=?, nota=?, activa=? WHERE id=?',
    [nombre, meta_monto_usd, meta_fecha, nota, activa, id]
  );
  return resumenInversion(await get('SELECT * FROM inversiones WHERE id=?', [id]));
}

async function borrarInversion(id) {
  await run('DELETE FROM movimientos_inversion WHERE inversion_id=?', [id]);
  await run('DELETE FROM inversiones WHERE id=?', [id]);
}

async function agregarMovimientoInversion(inversionId, body) {
  const inv = await get('SELECT * FROM inversiones WHERE id=?', [inversionId]);
  if (!inv) throw new Error('Inversión no encontrada');
  const { fecha, tipo, monto_original, moneda, tasa_tipo, cuenta_id, nota } = body;
  if (!fecha || !tipo || !monto_original || !moneda) {
    throw new Error('Faltan campos obligatorios (fecha, tipo, monto_original, moneda)');
  }
  if (!['aporte', 'retorno', 'costo'].includes(tipo)) throw new Error('Tipo inválido (usa aporte, retorno o costo)');

  const tasas = await obtenerTasas();
  let tasa_usada = body.tasa_usada ? Number(body.tasa_usada) : null;
  if ((moneda === 'VES' || moneda === 'EUR') && !tasa_usada) tasa_usada = resolverTasa(tasa_tipo, moneda, tasas);
  const monto_usd = convertirAUsd(monto_original, moneda, tasa_usada, tasas);

  const info = await run(
    `INSERT INTO movimientos_inversion (inversion_id, fecha, tipo, monto_original, moneda, tasa_usada, monto_usd, cuenta_id, nota)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [inversionId, fecha, tipo, monto_original, moneda, tasa_usada, monto_usd, cuenta_id || null, nota || null]
  );
  return get('SELECT * FROM movimientos_inversion WHERE id=?', [info.lastInsertRowid]);
}

async function borrarMovimientoInversion(id) {
  await run('DELETE FROM movimientos_inversion WHERE id=?', [id]);
}

module.exports = {
  crearInversion, listarInversiones, obtenerInversion, actualizarInversion, borrarInversion,
  agregarMovimientoInversion, borrarMovimientoInversion
};
