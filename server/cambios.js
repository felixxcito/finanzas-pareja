const { get, all, run } = require('./db');
const { obtenerTasas, resolverTasa } = require('./rates');

// Un cambio de divisa NO es ingreso ni gasto: solo mueve plata entre dos bolsillos.
// Por eso vive en su propia tabla, fuera de "movimientos", y resumenMes() no lo toca.
async function crearCambio(body) {
  const { fecha, cuenta_origen_id, monto_origen, cuenta_destino_id, tasa_tipo, nota } = body;
  if (!fecha || !cuenta_origen_id || !monto_origen || !cuenta_destino_id) {
    throw new Error('Faltan campos obligatorios (fecha, cuenta_origen_id, monto_origen, cuenta_destino_id)');
  }
  if (Number(cuenta_origen_id) === Number(cuenta_destino_id)) {
    throw new Error('El bolsillo de origen y el de destino no pueden ser el mismo');
  }
  const origen = await get('SELECT * FROM cuentas WHERE id=?', [cuenta_origen_id]);
  const destino = await get('SELECT * FROM cuentas WHERE id=?', [cuenta_destino_id]);
  if (!origen || !destino) throw new Error('Bolsillo no encontrado');

  const tasas = await obtenerTasas();
  let tasa_usada = body.tasa_usada ? Number(body.tasa_usada) : null;
  if (!tasa_usada) {
    tasa_usada = (origen.moneda === 'VES' || destino.moneda === 'VES') ? resolverTasa(tasa_tipo, 'VES', tasas) : 1;
  }
  if (!tasa_usada || tasa_usada <= 0) throw new Error('Falta la tasa de cambio');

  const montoOrigenNum = Number(monto_origen);
  let monto_destino;
  if (origen.moneda === destino.moneda) monto_destino = montoOrigenNum;
  else if (origen.moneda === 'VES') monto_destino = montoOrigenNum / tasa_usada;
  else if (destino.moneda === 'VES') monto_destino = montoOrigenNum * tasa_usada;
  else monto_destino = montoOrigenNum; // USD <-> USDT, 1:1

  const monto_usd = origen.moneda === 'VES' ? montoOrigenNum / tasa_usada : montoOrigenNum;

  const info = await run(
    `INSERT INTO cambios (fecha, cuenta_origen_id, monto_origen, cuenta_destino_id, monto_destino, tasa_usada, tasa_tipo, monto_usd, nota)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [fecha, cuenta_origen_id, montoOrigenNum, cuenta_destino_id, monto_destino, tasa_usada, tasa_tipo || null, monto_usd, nota || null]
  );
  return get('SELECT * FROM cambios WHERE id=?', [info.lastInsertRowid]);
}

async function listarCambios(query = {}) {
  let sql = 'SELECT * FROM cambios WHERE 1=1';
  const params = [];
  if (query.mes) { sql += ' AND substr(fecha,1,7) = ?'; params.push(query.mes); }
  sql += ' ORDER BY fecha DESC, id DESC';
  return all(sql, params);
}

async function borrarCambio(id) {
  await run('DELETE FROM cambios WHERE id=?', [id]);
}

module.exports = { crearCambio, listarCambios, borrarCambio };
