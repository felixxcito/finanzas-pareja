const { get, all, run, dbLista, getConfig, setConfig } = require('./db');
const { obtenerTasas, convertirAUsd, resolverTasa } = require('./rates');
const cuentasMod = require('./cuentas');
const cambiosMod = require('./cambios');
const inversionesMod = require('./inversiones');
const adjuntosMod = require('./adjuntos');
const { calcularMetas } = require('./metas');

// Vercel corta cualquier request de función en 4.5MB — con margen para que quepa
// cómodo (el resto del body es apenas unos campos de texto).
const MAX_BODY_BYTES = 4 * 1024 * 1024;

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  // En Vercel el request ya llega con el body parseado (según Content-Type) antes
  // de que nuestro código corra — ahí no hace falta (ni se puede) leer el stream.
  if (req.body !== undefined) {
    if (typeof req.body === 'string') return Promise.resolve(req.body ? JSON.parse(req.body) : {});
    return Promise.resolve(req.body || {});
  }
  return new Promise((resolve, reject) => {
    const trozos = []; // Buffers, no strings: concatenar strings por chunk puede
    let bytes = 0;      // partir un caracter multibyte (ej. ñ, é) justo en el borde
    let corto = false;  // de un paquete de red y corromperlo.
    req.on('data', (c) => {
      if (corto) return;
      bytes += c.length;
      if (bytes > MAX_BODY_BYTES) {
        corto = true;
        req.destroy();
        reject(new Error('El cuerpo de la petición es muy grande (máximo 4MB)'));
        return;
      }
      trozos.push(c);
    });
    req.on('end', () => {
      if (corto) return;
      if (!bytes) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(trozos).toString('utf8')));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', (err) => { if (!corto) reject(err); });
  });
}

function mesDe(fecha) {
  return (fecha || '').slice(0, 7);
}

// Traduce {moneda, monto_original, tasa_tipo, tasa_usada} a {tasa_usada, monto_usd},
// resolviendo la etiqueta de tasa con resolverTasa() cuando no viene una tasa explícita.
// Compartido por movimientos, deudas y pagos de deuda para que todos conviertan igual.
function resolverMontoUsdConTasa({ moneda, monto_original, tasa_tipo, tasa_usada }, tasas) {
  let tasa = tasa_usada ? Number(tasa_usada) : null;
  if ((moneda === 'VES' || moneda === 'EUR') && !tasa) tasa = resolverTasa(tasa_tipo, moneda, tasas);
  const monto_usd = convertirAUsd(monto_original, moneda, tasa, tasas);
  return { tasa_usada: tasa, monto_usd };
}

// ---------- Movimientos (ingresos y gastos) ----------

async function crearMovimiento(body) {
  const { tipo, fecha, monto_original, tasa_tipo, categoria, persona, metodo, nota, cuenta_id } = body;
  if (!tipo || !fecha || !monto_original || !persona || !cuenta_id) {
    throw new Error('Faltan campos obligatorios (tipo, fecha, monto_original, persona, cuenta_id)');
  }
  if (tipo === 'gasto' && !nota) throw new Error('Los gastos necesitan una descripción');
  const cuenta = await get('SELECT * FROM cuentas WHERE id = ?', [cuenta_id]);
  if (!cuenta) throw new Error('Bolsillo no encontrado');

  const tasas = await obtenerTasas();
  const { tasa_usada, monto_usd } = resolverMontoUsdConTasa(
    { moneda: cuenta.moneda, monto_original, tasa_tipo, tasa_usada: body.tasa_usada }, tasas
  );

  const info = await run(
    `INSERT INTO movimientos (tipo, fecha, monto_original, moneda, tasa_usada, tasa_tipo, monto_usd, categoria, persona, metodo, nota, cuenta_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [tipo, fecha, monto_original, cuenta.moneda, tasa_usada, tasa_tipo || null, monto_usd, categoria || null, persona, metodo || null, nota || null, cuenta_id]
  );
  return get('SELECT * FROM movimientos WHERE id = ?', [info.lastInsertRowid]);
}

async function actualizarMovimiento(id, body) {
  const existente = await get('SELECT * FROM movimientos WHERE id = ?', [id]);
  if (!existente) throw new Error('Movimiento no encontrado');

  const cuenta_id = body.cuenta_id ?? existente.cuenta_id;
  if (!cuenta_id) throw new Error('Falta el bolsillo (cuenta_id)');
  const cuenta = await get('SELECT * FROM cuentas WHERE id = ?', [cuenta_id]);
  if (!cuenta) throw new Error('Bolsillo no encontrado');

  const tipo = body.tipo ?? existente.tipo;
  const fecha = body.fecha ?? existente.fecha;
  const monto_original = body.monto_original ?? existente.monto_original;
  const tasa_tipo = body.tasa_tipo !== undefined ? body.tasa_tipo : existente.tasa_tipo;
  const categoria = body.categoria !== undefined ? body.categoria : existente.categoria;
  const persona = body.persona ?? existente.persona;
  const metodo = body.metodo !== undefined ? body.metodo : existente.metodo;
  const nota = body.nota !== undefined ? body.nota : existente.nota;
  if (tipo === 'gasto' && !nota) throw new Error('Los gastos necesitan una descripción');

  const tasas = await obtenerTasas();
  let tasa_usada, monto_usd;
  const algoRelevanteCambio = cuenta.moneda !== existente.moneda || tasa_tipo !== existente.tasa_tipo || Number(monto_original) !== existente.monto_original;
  if (body.tasa_usada) {
    tasa_usada = Number(body.tasa_usada);
    monto_usd = convertirAUsd(monto_original, cuenta.moneda, tasa_usada, tasas);
  } else if (algoRelevanteCambio) {
    ({ tasa_usada, monto_usd } = resolverMontoUsdConTasa({ moneda: cuenta.moneda, monto_original, tasa_tipo }, tasas));
  } else {
    tasa_usada = existente.tasa_usada;
    monto_usd = existente.monto_usd;
  }

  await run(
    `UPDATE movimientos SET tipo=?, fecha=?, monto_original=?, moneda=?, tasa_usada=?, tasa_tipo=?, monto_usd=?, categoria=?, persona=?, metodo=?, nota=?, cuenta_id=?
     WHERE id=?`,
    [tipo, fecha, monto_original, cuenta.moneda, tasa_usada, tasa_tipo || null, monto_usd, categoria || null, persona, metodo || null, nota || null, cuenta_id, id]
  );
  return get('SELECT * FROM movimientos WHERE id=?', [id]);
}

async function listarMovimientos(query) {
  let sql = 'SELECT * FROM movimientos WHERE 1=1';
  const params = [];
  if (query.mes) { sql += ' AND substr(fecha,1,7) = ?'; params.push(query.mes); }
  if (query.tipo) { sql += ' AND tipo = ?'; params.push(query.tipo); }
  if (query.persona) { sql += ' AND persona = ?'; params.push(query.persona); }
  if (query.categoria) { sql += ' AND categoria = ?'; params.push(query.categoria); }
  if (query.cuenta_id) { sql += ' AND cuenta_id = ?'; params.push(Number(query.cuenta_id)); }
  sql += ' ORDER BY fecha DESC, id DESC';
  const movimientos = await all(sql, params);
  return Promise.all(movimientos.map(async (m) => ({ ...m, adjuntos: await adjuntosMod.listarAdjuntos('movimiento', m.id) })));
}

async function borrarMovimiento(id) {
  await adjuntosMod.borrarAdjuntosDe('movimiento', id);
  await run('DELETE FROM movimientos WHERE id = ?', [id]);
}

// ---------- Deudas ----------

async function crearDeuda(body) {
  const { nombre, monto_total, moneda, persona, fecha_inicio, fecha_limite, nota, tasa_tipo, origen } = body;
  if (!nombre || !monto_total || !moneda || !persona || !fecha_inicio) {
    throw new Error('Faltan campos obligatorios (nombre, monto_total, moneda, persona, fecha_inicio)');
  }
  const tasas = await obtenerTasas();
  const { tasa_usada, monto_usd: monto_total_usd } = resolverMontoUsdConTasa(
    { moneda, monto_original: monto_total, tasa_tipo, tasa_usada: body.tasa_usada }, tasas
  );

  // Cashea: precio total = inicial (se paga al momento de la compra) + N cuotas
  // iguales sin interés, cada 14 días. El inicial se registra de una vez como el
  // primer pago, así el progreso de la deuda ya lo cuenta desde el día uno.
  let cuotas_totales = null, frecuencia_dias = null, monto_cuota_usd = null, inicial_usd = null;
  if (origen === 'cashea') {
    const { inicial, cuenta_id } = body;
    cuotas_totales = Number(body.cuotas_totales);
    frecuencia_dias = Number(body.frecuencia_dias) || 14;
    if (!cuotas_totales || cuotas_totales < 1) throw new Error('Cashea necesita un número de cuotas (3, 6, 9 o 12)');
    if (inicial === undefined || inicial === null || inicial === '') throw new Error('Cashea necesita el monto del inicial pagado');
    if (!cuenta_id) throw new Error('Cashea necesita de qué bolsillo salió el inicial');
    inicial_usd = convertirAUsd(inicial, moneda, tasa_usada, tasas);
    if (inicial_usd >= monto_total_usd) throw new Error('El inicial no puede ser igual o mayor al precio total');
    monto_cuota_usd = (monto_total_usd - inicial_usd) / cuotas_totales;
  }

  const info = await run(
    `INSERT INTO deudas (nombre, monto_total, moneda, tasa_usada, tasa_tipo, monto_total_usd, persona, fecha_inicio, fecha_limite, nota, origen, cuotas_totales, frecuencia_dias, monto_cuota_usd)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [nombre, monto_total, moneda, tasa_usada, tasa_tipo || null, monto_total_usd, persona, fecha_inicio, fecha_limite || null, nota || null, origen || null, cuotas_totales, frecuencia_dias, monto_cuota_usd]
  );

  if (origen === 'cashea') {
    await run(
      `INSERT INTO pagos_deuda (deuda_id, fecha, monto_original, moneda, tasa_usada, tasa_tipo, monto_usd, cuenta_id, nota)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [info.lastInsertRowid, fecha_inicio, body.inicial, moneda, tasa_usada, tasa_tipo || null, inicial_usd, body.cuenta_id, 'Inicial']
    );
  }

  return get('SELECT * FROM deudas WHERE id = ?', [info.lastInsertRowid]);
}

async function actualizarDeuda(id, body) {
  const existente = await get('SELECT * FROM deudas WHERE id = ?', [id]);
  if (!existente) throw new Error('Deuda no encontrada');
  const nombre = body.nombre ?? existente.nombre;
  const persona = body.persona ?? existente.persona;
  const fecha_limite = body.fecha_limite !== undefined ? body.fecha_limite : existente.fecha_limite;
  const nota = body.nota !== undefined ? body.nota : existente.nota;
  const activa = body.activa !== undefined ? (body.activa ? 1 : 0) : existente.activa;

  let monto_total = body.monto_total ?? existente.monto_total;
  let moneda = body.moneda ?? existente.moneda;
  let tasa_tipo = body.tasa_tipo !== undefined ? body.tasa_tipo : existente.tasa_tipo;
  let tasa_usada = existente.tasa_usada;
  let monto_total_usd = existente.monto_total_usd;

  const relevante = moneda !== existente.moneda || tasa_tipo !== existente.tasa_tipo || Number(monto_total) !== existente.monto_total;
  if (body.tasa_usada) {
    tasa_usada = Number(body.tasa_usada);
    const tasas = await obtenerTasas();
    monto_total_usd = convertirAUsd(monto_total, moneda, tasa_usada, tasas);
  } else if (relevante) {
    const tasas = await obtenerTasas();
    ({ tasa_usada, monto_usd: monto_total_usd } = resolverMontoUsdConTasa({ moneda, monto_original: monto_total, tasa_tipo }, tasas));
  }

  await run(
    `UPDATE deudas SET nombre=?, monto_total=?, moneda=?, tasa_usada=?, tasa_tipo=?, monto_total_usd=?, persona=?, fecha_limite=?, nota=?, activa=?
     WHERE id=?`,
    [nombre, monto_total, moneda, tasa_usada, tasa_tipo || null, monto_total_usd, persona, fecha_limite || null, nota || null, activa, id]
  );
  return get('SELECT * FROM deudas WHERE id=?', [id]);
}

function sumarDias(fechaStr, dias) {
  const [y, m, d] = fechaStr.split('-').map(Number);
  const fecha = new Date(y, m - 1, d + dias);
  return formatoMesInterno(fecha) + '-' + String(fecha.getDate()).padStart(2, '0');
}

async function listarDeudas() {
  const deudas = await all('SELECT * FROM deudas ORDER BY activa DESC, creado_en DESC');
  return Promise.all(deudas.map(async (d) => {
    const pagosCrudos = await all('SELECT * FROM pagos_deuda WHERE deuda_id = ? ORDER BY fecha DESC, id DESC', [d.id]);
    const pagos = await Promise.all(pagosCrudos.map(async (p) => ({ ...p, adjuntos: await adjuntosMod.listarAdjuntos('pago_deuda', p.id) })));
    const pagado_usd = pagos.reduce((a, p) => a + p.monto_usd, 0);
    const base = { ...d, pagos, pagado_usd, restante_usd: Math.max(0, d.monto_total_usd - pagado_usd) };

    if (d.origen === 'cashea' && d.cuotas_totales) {
      // El primer pago siempre es el inicial (se registra solo al crearla) — el
      // resto son cuotas. Cada cuota vence cada frecuencia_dias desde la compra.
      const cuotasPagadas = Math.max(0, pagos.length - 1);
      const cuotasRestantes = Math.max(0, d.cuotas_totales - cuotasPagadas);
      base.cuotas_pagadas = cuotasPagadas;
      base.cuotas_restantes = cuotasRestantes;
      base.proxima_cuota_fecha = cuotasRestantes > 0
        ? sumarDias(d.fecha_inicio, d.frecuencia_dias * (cuotasPagadas + 1))
        : null;
    }
    return base;
  }));
}

async function registrarPago(deudaId, body) {
  const deuda = await get('SELECT * FROM deudas WHERE id = ?', [deudaId]);
  if (!deuda) throw new Error('Deuda no encontrada');
  const { fecha, monto_original, moneda, tasa_tipo, nota, cuenta_id } = body;
  if (!fecha || !monto_original || !moneda || !cuenta_id) {
    throw new Error('Faltan campos obligatorios (fecha, monto_original, moneda, cuenta_id)');
  }
  const tasas = await obtenerTasas();
  const { tasa_usada, monto_usd } = resolverMontoUsdConTasa({ moneda, monto_original, tasa_tipo, tasa_usada: body.tasa_usada }, tasas);
  const info = await run(
    `INSERT INTO pagos_deuda (deuda_id, fecha, monto_original, moneda, tasa_usada, tasa_tipo, monto_usd, cuenta_id, nota)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [deudaId, fecha, monto_original, moneda, tasa_usada, tasa_tipo || null, monto_usd, cuenta_id, nota || null]
  );

  const pagos = await all('SELECT * FROM pagos_deuda WHERE deuda_id = ?', [deudaId]);
  const pagado_usd = pagos.reduce((a, p) => a + p.monto_usd, 0);
  if (pagado_usd >= deuda.monto_total_usd - 0.01) {
    await run('UPDATE deudas SET activa = 0 WHERE id = ?', [deudaId]);
  }
  return get('SELECT * FROM pagos_deuda WHERE id = ?', [info.lastInsertRowid]);
}

async function borrarDeuda(id) {
  const pagos = await all('SELECT id FROM pagos_deuda WHERE deuda_id = ?', [id]);
  for (const p of pagos) await adjuntosMod.borrarAdjuntosDe('pago_deuda', p.id);
  await run('DELETE FROM pagos_deuda WHERE deuda_id = ?', [id]);
  await run('DELETE FROM deudas WHERE id = ?', [id]);
}

// Antes, borrar un pago siempre reabría la deuda aunque los pagos restantes ya la
// cubrieran (ej. al borrar un pago duplicado). Ahora se recalcula.
async function borrarPago(deudaId, pagoId) {
  const deuda = await get('SELECT * FROM deudas WHERE id = ?', [deudaId]);
  await adjuntosMod.borrarAdjuntosDe('pago_deuda', pagoId);
  await run('DELETE FROM pagos_deuda WHERE id = ? AND deuda_id = ?', [pagoId, deudaId]);
  if (deuda) {
    const pagos = await all('SELECT * FROM pagos_deuda WHERE deuda_id = ?', [deudaId]);
    const pagado_usd = pagos.reduce((a, p) => a + p.monto_usd, 0);
    const activa = pagado_usd >= deuda.monto_total_usd - 0.01 ? 0 : 1;
    await run('UPDATE deudas SET activa = ? WHERE id = ?', [activa, deudaId]);
  }
}

// ---------- Resumen / matemática de ahorro ----------

function diasEnMes(mes) {
  const [y, m] = mes.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}
function formatoMesInterno(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function resumenMes(mes) {
  const movimientos = await listarMovimientos({ mes });
  const ingresos = movimientos.filter((m) => m.tipo === 'ingreso');
  const gastos = movimientos.filter((m) => m.tipo === 'gasto');

  const ingresoFeli = ingresos.filter((m) => m.persona === 'feli').reduce((a, m) => a + m.monto_usd, 0);
  const ingresoVale = ingresos.filter((m) => m.persona === 'vale').reduce((a, m) => a + m.monto_usd, 0);
  const ingresoAmbos = ingresos.filter((m) => m.persona === 'ambos').reduce((a, m) => a + m.monto_usd, 0);
  const ingresoTotal = ingresoFeli + ingresoVale + ingresoAmbos;

  const gastoTotal = gastos.reduce((a, m) => a + m.monto_usd, 0);
  const gastoPorCategoria = {};
  for (const g of gastos) {
    const cat = g.categoria || 'Otros';
    gastoPorCategoria[cat] = (gastoPorCategoria[cat] || 0) + g.monto_usd;
  }
  const gastoPorPersona = { feli: 0, vale: 0, ambos: 0 };
  for (const g of gastos) gastoPorPersona[g.persona] += g.monto_usd;

  const deudas = await listarDeudas();
  const pagosDeudaMes = deudas.flatMap((d) => d.pagos.filter((p) => mesDe(p.fecha) === mes));
  const pagoDeudaTotal = pagosDeudaMes.reduce((a, p) => a + p.monto_usd, 0);
  const deudaPendienteTotal = deudas.filter((d) => d.activa).reduce((a, d) => a + d.restante_usd, 0);

  const metaCfg = (await getConfig('meta_ahorro')) || { modo: 'pct', monto_mensual: 200, pct: 20 };
  const ahorroSugerido = metaCfg.modo === 'monto' ? metaCfg.monto_mensual : ingresoTotal * (metaCfg.pct / 100);
  const ahorroReal = ingresoTotal - gastoTotal - pagoDeudaTotal;
  const diferencia = ahorroReal - ahorroSugerido;

  const hoy = new Date();
  const mesActual = formatoMesInterno(hoy);

  let proyeccionGasto = null;
  let proyeccionPorCategoria = null;
  let promedioHistorico = null;
  let diaHoy = null;
  const totalDiasMes = diasEnMes(mes);

  if (mes === mesActual) {
    diaHoy = hoy.getDate();
    const proyeccionRitmo = diaHoy > 0 ? (gastoTotal / diaHoy) * totalDiasMes : 0;

    const mesesPrevios = [];
    for (let i = 1; i <= 3; i++) mesesPrevios.push(formatoMesInterno(new Date(hoy.getFullYear(), hoy.getMonth() - i, 1)));
    const totalesPrevios = await Promise.all(
      mesesPrevios.map((m) => get(`SELECT COALESCE(SUM(monto_usd),0) AS t FROM movimientos WHERE tipo='gasto' AND substr(fecha,1,7)=?`, [m]))
    );
    const gastosPrevios = totalesPrevios.map((r) => r.t).filter((t) => t > 0);
    promedioHistorico = gastosPrevios.length ? gastosPrevios.reduce((a, b) => a + b, 0) / gastosPrevios.length : null;

    const pesoRitmo = totalDiasMes > 0 ? diaHoy / totalDiasMes : 1;
    proyeccionGasto = promedioHistorico !== null
      ? pesoRitmo * proyeccionRitmo + (1 - pesoRitmo) * promedioHistorico
      : proyeccionRitmo;

    const factorAjuste = proyeccionRitmo > 0 ? proyeccionGasto / proyeccionRitmo : 1;
    proyeccionPorCategoria = {};
    for (const [cat, monto] of Object.entries(gastoPorCategoria)) {
      const catRitmo = diaHoy > 0 ? (monto / diaHoy) * totalDiasMes : monto;
      proyeccionPorCategoria[cat] = catRitmo * factorAjuste;
    }
  }

  return {
    mes,
    dia_actual: diaHoy,
    dias_del_mes: totalDiasMes,
    ingreso_total: ingresoTotal,
    ingreso_feli: ingresoFeli,
    ingreso_vale: ingresoVale,
    ingreso_ambos: ingresoAmbos,
    gasto_total: gastoTotal,
    gasto_por_categoria: gastoPorCategoria,
    gasto_por_persona: gastoPorPersona,
    pago_deuda_total: pagoDeudaTotal,
    deuda_pendiente_total: deudaPendienteTotal,
    meta_ahorro: metaCfg,
    ahorro_sugerido: ahorroSugerido,
    ahorro_real: ahorroReal,
    diferencia_ahorro: diferencia,
    proyeccion_gasto_fin_mes: proyeccionGasto,
    proyeccion_por_categoria: proyeccionPorCategoria,
    promedio_gasto_historico: promedioHistorico,
    cantidad_gastos: gastos.length,
    cantidad_ingresos: ingresos.length
  };
}

async function historialResumen(nMeses, hastaMes) {
  let base;
  if (hastaMes) {
    const [y, m] = hastaMes.split('-').map(Number);
    base = new Date(y, m - 1, 1);
  } else {
    base = new Date();
  }
  const meses = [];
  for (let i = nMeses - 1; i >= 0; i--) meses.push(formatoMesInterno(new Date(base.getFullYear(), base.getMonth() - i, 1)));
  return Promise.all(meses.map((m) => resumenMes(m)));
}

async function historialTasas(dias = 30) {
  return all(
    `SELECT * FROM tasas_historial WHERE fecha >= datetime('now', 'localtime', ?) ORDER BY fecha ASC`,
    [`-${dias} days`]
  );
}

// ---------- Router ----------

async function handleApi(req, res, pathname, query) {
  const parts = pathname.split('/').filter(Boolean); // ['api', ...]
  if (parts[0] !== 'api') return false;

  try {
    await dbLista();

    // /api/tasas
    if (parts[1] === 'tasas' && parts.length === 2 && req.method === 'GET') {
      sendJson(res, 200, await obtenerTasas(query.forzar === '1'));
      return true;
    }
    if (parts[1] === 'tasas' && parts[2] === 'historial' && req.method === 'GET') {
      sendJson(res, 200, await historialTasas(Number(query.dias) || 30));
      return true;
    }

    // /api/movimientos
    if (parts[1] === 'movimientos' && parts.length === 2) {
      if (req.method === 'GET') { sendJson(res, 200, await listarMovimientos(query)); return true; }
      if (req.method === 'POST') { sendJson(res, 201, await crearMovimiento(await readBody(req))); return true; }
    }
    if (parts[1] === 'movimientos' && parts.length === 3) {
      if (req.method === 'PUT') { sendJson(res, 200, await actualizarMovimiento(Number(parts[2]), await readBody(req))); return true; }
      if (req.method === 'DELETE') { await borrarMovimiento(Number(parts[2])); sendJson(res, 200, { ok: true }); return true; }
    }

    // /api/deudas
    if (parts[1] === 'deudas' && parts.length === 2) {
      if (req.method === 'GET') { sendJson(res, 200, await listarDeudas()); return true; }
      if (req.method === 'POST') { sendJson(res, 201, await crearDeuda(await readBody(req))); return true; }
    }
    if (parts[1] === 'deudas' && parts.length === 3) {
      if (req.method === 'PUT') { sendJson(res, 200, await actualizarDeuda(Number(parts[2]), await readBody(req))); return true; }
      if (req.method === 'DELETE') { await borrarDeuda(Number(parts[2])); sendJson(res, 200, { ok: true }); return true; }
    }
    if (parts[1] === 'deudas' && parts[3] === 'pagos' && parts.length === 4 && req.method === 'POST') {
      sendJson(res, 201, await registrarPago(Number(parts[2]), await readBody(req)));
      return true;
    }
    if (parts[1] === 'deudas' && parts[3] === 'pagos' && parts.length === 5 && req.method === 'DELETE') {
      await borrarPago(Number(parts[2]), Number(parts[4]));
      sendJson(res, 200, { ok: true });
      return true;
    }

    // /api/cuentas (bolsillos)
    if (parts[1] === 'cuentas' && parts[2] === 'saldos' && req.method === 'GET') {
      sendJson(res, 200, await cuentasMod.listarCuentas({ soloActivas: query.todas !== '1' }));
      return true;
    }
    if (parts[1] === 'cuentas' && parts.length === 2) {
      if (req.method === 'GET') { sendJson(res, 200, await cuentasMod.listarCuentas({ soloActivas: query.todas !== '1' })); return true; }
      if (req.method === 'POST') { sendJson(res, 201, await cuentasMod.crearCuenta(await readBody(req))); return true; }
    }
    if (parts[1] === 'cuentas' && parts.length === 3) {
      if (req.method === 'PUT') { sendJson(res, 200, await cuentasMod.actualizarCuenta(Number(parts[2]), await readBody(req))); return true; }
      if (req.method === 'DELETE') { await cuentasMod.borrarCuenta(Number(parts[2])); sendJson(res, 200, { ok: true }); return true; }
    }

    // /api/cambios
    if (parts[1] === 'cambios' && parts.length === 2) {
      if (req.method === 'GET') { sendJson(res, 200, await cambiosMod.listarCambios(query)); return true; }
      if (req.method === 'POST') { sendJson(res, 201, await cambiosMod.crearCambio(await readBody(req))); return true; }
    }
    if (parts[1] === 'cambios' && parts.length === 3 && req.method === 'DELETE') {
      await cambiosMod.borrarCambio(Number(parts[2]));
      sendJson(res, 200, { ok: true });
      return true;
    }

    // /api/inversiones
    if (parts[1] === 'inversiones' && parts.length === 2) {
      if (req.method === 'GET') { sendJson(res, 200, await inversionesMod.listarInversiones()); return true; }
      if (req.method === 'POST') { sendJson(res, 201, await inversionesMod.crearInversion(await readBody(req))); return true; }
    }
    if (parts[1] === 'inversiones' && parts.length === 3) {
      if (req.method === 'GET') { sendJson(res, 200, await inversionesMod.obtenerInversion(Number(parts[2]))); return true; }
      if (req.method === 'PUT') { sendJson(res, 200, await inversionesMod.actualizarInversion(Number(parts[2]), await readBody(req))); return true; }
      if (req.method === 'DELETE') { await inversionesMod.borrarInversion(Number(parts[2])); sendJson(res, 200, { ok: true }); return true; }
    }
    if (parts[1] === 'inversiones' && parts[3] === 'movimientos' && parts.length === 4 && req.method === 'POST') {
      sendJson(res, 201, await inversionesMod.agregarMovimientoInversion(Number(parts[2]), await readBody(req)));
      return true;
    }
    if (parts[1] === 'inversiones' && parts[3] === 'movimientos' && parts.length === 5 && req.method === 'DELETE') {
      await inversionesMod.borrarMovimientoInversion(Number(parts[4]));
      sendJson(res, 200, { ok: true });
      return true;
    }

    // /api/adjuntos
    if (parts[1] === 'adjuntos' && parts[2] === 'archivo' && parts.length === 4 && req.method === 'GET') {
      const archivo = await adjuntosMod.obtenerArchivo(Number(parts[3]));
      if (!archivo) { sendJson(res, 404, { error: 'Adjunto no encontrado' }); return true; }
      res.writeHead(200, { 'Content-Type': archivo.mime, 'Cache-Control': 'private, max-age=86400' });
      res.end(archivo.buffer);
      return true;
    }
    if (parts[1] === 'adjuntos' && parts.length === 2) {
      if (req.method === 'GET') { sendJson(res, 200, await adjuntosMod.listarAdjuntos(query.entidad, Number(query.entidad_id))); return true; }
      if (req.method === 'POST') { sendJson(res, 201, await adjuntosMod.guardarAdjunto(await readBody(req))); return true; }
    }
    if (parts[1] === 'adjuntos' && parts.length === 3 && req.method === 'DELETE') {
      await adjuntosMod.borrarAdjunto(Number(parts[2]));
      sendJson(res, 200, { ok: true });
      return true;
    }

    // /api/metas
    if (parts[1] === 'metas' && req.method === 'GET') {
      sendJson(res, 200, await calcularMetas(query.hasta));
      return true;
    }

    // /api/config
    if (parts[1] === 'config' && parts.length === 2) {
      if (req.method === 'GET') {
        const [nombres, ingreso_fijo, meta_ahorro, tasa_efectivo_manual, categorias_gasto] = await Promise.all([
          getConfig('nombres'), getConfig('ingreso_fijo'), getConfig('meta_ahorro'), getConfig('tasa_efectivo_manual'), getConfig('categorias_gasto')
        ]);
        sendJson(res, 200, { nombres, ingreso_fijo, meta_ahorro, tasa_efectivo_manual, categorias_gasto });
        return true;
      }
      if (req.method === 'PUT') {
        const body = await readBody(req);
        for (const clave of ['nombres', 'ingreso_fijo', 'meta_ahorro', 'tasa_efectivo_manual', 'categorias_gasto']) {
          if (body[clave] !== undefined) await setConfig(clave, body[clave]);
        }
        sendJson(res, 200, { ok: true });
        return true;
      }
    }

    // /api/resumen
    if (parts[1] === 'resumen' && parts[2] === 'historial' && req.method === 'GET') {
      sendJson(res, 200, await historialResumen(Number(query.meses) || 6, query.hasta));
      return true;
    }
    if (parts[1] === 'resumen' && parts.length === 2 && req.method === 'GET') {
      const hoy = new Date();
      const mes = query.mes || formatoMesInterno(hoy);
      sendJson(res, 200, await resumenMes(mes));
      return true;
    }

    sendJson(res, 404, { error: 'Ruta no encontrada: ' + pathname });
    return true;
  } catch (err) {
    sendJson(res, 400, { error: err.message });
    return true;
  }
}

module.exports = { handleApi };
