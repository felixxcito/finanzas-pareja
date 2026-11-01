const { get, all, run } = require('./db');

// Saldo calculado a partir de todos los movimientos que tocan ese bolsillo.
// La moneda del bolsillo define la moneda de todo lo que entra/sale de él, así
// que el saldo es una suma directa de monto_original sin necesidad de convertir.
async function saldoDeCuenta(cuentaId) {
  const cuenta = await get('SELECT * FROM cuentas WHERE id = ?', [cuentaId]);
  if (!cuenta) return 0;
  const suma = async (sql) => (await get(sql, [cuentaId])).t;
  const [ingresos, gastos, pagosDeuda, cambiosEntrada, cambiosSalida, aportesInv, retornosInv, costosInv] = await Promise.all([
    suma(`SELECT COALESCE(SUM(monto_original),0) t FROM movimientos WHERE tipo='ingreso' AND cuenta_id=?`),
    suma(`SELECT COALESCE(SUM(monto_original),0) t FROM movimientos WHERE tipo='gasto' AND cuenta_id=?`),
    suma(`SELECT COALESCE(SUM(monto_original),0) t FROM pagos_deuda WHERE cuenta_id=?`),
    suma(`SELECT COALESCE(SUM(monto_destino),0) t FROM cambios WHERE cuenta_destino_id=?`),
    suma(`SELECT COALESCE(SUM(monto_origen),0) t FROM cambios WHERE cuenta_origen_id=?`),
    suma(`SELECT COALESCE(SUM(monto_original),0) t FROM movimientos_inversion WHERE tipo='aporte' AND cuenta_id=?`),
    suma(`SELECT COALESCE(SUM(monto_original),0) t FROM movimientos_inversion WHERE tipo='retorno' AND cuenta_id=?`),
    suma(`SELECT COALESCE(SUM(monto_original),0) t FROM movimientos_inversion WHERE tipo='costo' AND cuenta_id=?`)
  ]);
  return cuenta.saldo_inicial + ingresos - gastos - pagosDeuda + cambiosEntrada - cambiosSalida - aportesInv + retornosInv - costosInv;
}

async function listarCuentas({ soloActivas } = {}) {
  const cuentas = soloActivas
    ? await all('SELECT * FROM cuentas WHERE activa=1 ORDER BY orden, id')
    : await all('SELECT * FROM cuentas ORDER BY orden, id');
  return Promise.all(cuentas.map(async (c) => ({ ...c, saldo: await saldoDeCuenta(c.id) })));
}

async function crearCuenta(body) {
  const { nombre, moneda, tipo, saldo_inicial } = body;
  if (!nombre || !moneda) throw new Error('Faltan campos obligatorios (nombre, moneda)');
  if (!['USD', 'VES', 'EUR', 'USDT'].includes(moneda)) throw new Error('Moneda inválida');
  const orden = (await get('SELECT COALESCE(MAX(orden),0)+1 o FROM cuentas')).o;
  const info = await run(
    'INSERT INTO cuentas (nombre, moneda, tipo, saldo_inicial, orden) VALUES (?,?,?,?,?)',
    [nombre, moneda, tipo || 'otro', Number(saldo_inicial) || 0, orden]
  );
  return get('SELECT * FROM cuentas WHERE id=?', [info.lastInsertRowid]);
}

async function actualizarCuenta(id, body) {
  const cuenta = await get('SELECT * FROM cuentas WHERE id=?', [id]);
  if (!cuenta) throw new Error('Bolsillo no encontrado');
  // La moneda NO se puede cambiar una vez creado: ya hay (o puede haber) movimientos
  // asumiendo esa moneda para ese bolsillo.
  const nombre = body.nombre ?? cuenta.nombre;
  const activa = body.activa !== undefined ? (body.activa ? 1 : 0) : cuenta.activa;
  const saldo_inicial = body.saldo_inicial !== undefined ? Number(body.saldo_inicial) : cuenta.saldo_inicial;
  await run('UPDATE cuentas SET nombre=?, activa=?, saldo_inicial=? WHERE id=?', [nombre, activa, saldo_inicial, id]);
  return { ...(await get('SELECT * FROM cuentas WHERE id=?', [id])), saldo: await saldoDeCuenta(id) };
}

async function borrarCuenta(id) {
  const usado = (await get(
    `SELECT
      (SELECT COUNT(*) FROM movimientos WHERE cuenta_id=?) +
      (SELECT COUNT(*) FROM pagos_deuda WHERE cuenta_id=?) +
      (SELECT COUNT(*) FROM cambios WHERE cuenta_origen_id=? OR cuenta_destino_id=?) +
      (SELECT COUNT(*) FROM movimientos_inversion WHERE cuenta_id=?) AS n`,
    [id, id, id, id, id]
  )).n;
  if (usado > 0) throw new Error('Este bolsillo ya tiene movimientos — no se puede borrar. Puedes desactivarlo.');
  await run('DELETE FROM cuentas WHERE id=?', [id]);
}

module.exports = { listarCuentas, saldoDeCuenta, crearCuenta, actualizarCuenta, borrarCuenta };
