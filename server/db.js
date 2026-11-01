const { createClient } = require('@libsql/client');

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url) throw new Error('Falta la variable de entorno TURSO_DATABASE_URL');

const client = createClient({ url, authToken });

function filaAObjeto(fila, columnas) {
  const obj = {};
  columnas.forEach((c, i) => { obj[c] = fila[i]; });
  return obj;
}

// Helpers que imitan la forma de node:sqlite (.get()/.all()/.run()) pero async,
// para que el resto del código cambie lo mínimo posible al migrar a Turso.
async function run(sql, args = []) {
  const r = await client.execute({ sql, args });
  return { lastInsertRowid: Number(r.lastInsertRowid ?? 0), changes: r.rowsAffected };
}
async function get(sql, args = []) {
  const r = await client.execute({ sql, args });
  return r.rows[0] ? filaAObjeto(r.rows[0], r.columns) : undefined;
}
async function all(sql, args = []) {
  const r = await client.execute({ sql, args });
  return r.rows.map((fila) => filaAObjeto(fila, r.columns));
}
async function exec(sql) {
  await client.executeMultiple(sql);
}

// ---------- Migraciones idempotentes ----------
// Turso/libSQL no trae migraciones y ALTER TABLE ADD COLUMN explota si la columna ya existe.

async function columnaExiste(tabla, columna) {
  const cols = await all(`PRAGMA table_info(${tabla})`);
  return cols.some((c) => c.name === columna);
}

async function agregarColumna(tabla, columna, definicion) {
  if (!(await columnaExiste(tabla, columna))) {
    await run(`ALTER TABLE ${tabla} ADD COLUMN ${columna} ${definicion}`);
  }
}

async function tablaVacia(tabla) {
  try {
    const row = await get(`SELECT COUNT(*) AS c FROM ${tabla}`);
    return row.c === 0;
  } catch {
    return true;
  }
}

async function tablaExiste(tabla) {
  const row = await get(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [tabla]);
  return !!row;
}

const DEFAULT_CONFIG = {
  nombres: { feli: 'Pareja 1', vale: 'Pareja 2' },
  ingreso_fijo: {
    feli: { monto_por_pago: 0, moneda: 'USD', frecuencia: 'quincenal', dias: [1, 16] },
    vale: { monto_por_pago: 0, moneda: 'USD', frecuencia: 'semanal', dia_semana: 5 }
  },
  meta_ahorro: { modo: 'pct', monto_mensual: 0, pct: 20 },
  tasa_efectivo_manual: null,
  categorias_gasto: ['Mercado', 'Comida', 'Transporte', 'Servicios', 'Delivery', 'Ocio', 'Vicios', 'Cosas', 'Salud', 'Mascota', 'Otros']
};

const CUENTAS_INICIALES = [
  { nombre: 'Efectivo', moneda: 'USD', tipo: 'efectivo', orden: 1 },
  { nombre: 'Zelle', moneda: 'USD', tipo: 'zelle', orden: 2 },
  { nombre: 'USDT', moneda: 'USDT', tipo: 'usdt', orden: 3 },
  { nombre: 'Bolívares', moneda: 'VES', tipo: 'bolivares', orden: 4 }
];

async function getConfig(clave) {
  const row = await get('SELECT valor FROM config WHERE clave = ?', [clave]);
  return row ? JSON.parse(row.valor) : undefined;
}

async function setConfig(clave, valor) {
  await run(
    `INSERT INTO config (clave, valor) VALUES (?, ?)
     ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`,
    [clave, JSON.stringify(valor)]
  );
}

async function inicializarSchema() {
  await exec(`
    CREATE TABLE IF NOT EXISTS config (
      clave TEXT PRIMARY KEY,
      valor TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cuentas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      moneda TEXT NOT NULL CHECK(moneda IN ('USD','VES','EUR','USDT')),
      tipo TEXT NOT NULL,
      saldo_inicial REAL NOT NULL DEFAULT 0,
      activa INTEGER NOT NULL DEFAULT 1,
      orden INTEGER NOT NULL DEFAULT 0,
      creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS movimientos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo TEXT NOT NULL CHECK(tipo IN ('ingreso','gasto')),
      fecha TEXT NOT NULL,
      monto_original REAL NOT NULL,
      moneda TEXT NOT NULL CHECK(moneda IN ('USD','VES','EUR','USDT')),
      tasa_usada REAL,
      tasa_tipo TEXT,
      monto_usd REAL NOT NULL,
      categoria TEXT,
      persona TEXT NOT NULL CHECK(persona IN ('feli','vale','ambos')),
      metodo TEXT,
      nota TEXT,
      creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS cambios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha TEXT NOT NULL,
      cuenta_origen_id INTEGER NOT NULL REFERENCES cuentas(id),
      monto_origen REAL NOT NULL,
      cuenta_destino_id INTEGER NOT NULL REFERENCES cuentas(id),
      monto_destino REAL NOT NULL,
      tasa_usada REAL NOT NULL,
      tasa_tipo TEXT,
      monto_usd REAL NOT NULL,
      nota TEXT,
      creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS inversiones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      tipo TEXT NOT NULL CHECK(tipo IN ('negocio','fondo')),
      meta_monto_usd REAL,
      meta_fecha TEXT,
      nota TEXT,
      activa INTEGER NOT NULL DEFAULT 1,
      creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS movimientos_inversion (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inversion_id INTEGER NOT NULL REFERENCES inversiones(id) ON DELETE CASCADE,
      fecha TEXT NOT NULL,
      tipo TEXT NOT NULL CHECK(tipo IN ('aporte','retorno','costo')),
      monto_original REAL NOT NULL,
      moneda TEXT NOT NULL,
      tasa_usada REAL,
      monto_usd REAL NOT NULL,
      cuenta_id INTEGER REFERENCES cuentas(id),
      nota TEXT,
      creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS adjuntos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entidad TEXT NOT NULL CHECK(entidad IN ('movimiento','pago_deuda','cambio','movimiento_inversion')),
      entidad_id INTEGER NOT NULL,
      archivo TEXT NOT NULL,
      nombre_original TEXT,
      mime TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS tasas_historial (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      bcv_usd REAL,
      bcv_eur REAL,
      paralelo_usd REAL,
      paralelo_eur REAL,
      usdt_compra REAL,
      usdt_venta REAL
    );

    CREATE INDEX IF NOT EXISTS idx_movimientos_fecha ON movimientos(fecha);
    CREATE INDEX IF NOT EXISTS idx_cambios_fecha ON cambios(fecha);
    CREATE INDEX IF NOT EXISTS idx_adjuntos_entidad ON adjuntos(entidad, entidad_id);
    CREATE INDEX IF NOT EXISTS idx_mov_inv ON movimientos_inversion(inversion_id, fecha);
  `);

  // deudas/pagos_deuda nacieron con CHECK equivocados en versiones viejas. SQLite/libSQL
  // no permite alterar un CHECK, así que se recrean SOLO si están vacías; con datos, se respetan.
  const DDL_DEUDAS = `
    CREATE TABLE deudas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      monto_total REAL NOT NULL,
      moneda TEXT NOT NULL CHECK(moneda IN ('USD','VES','EUR','USDT')),
      tasa_usada REAL,
      tasa_tipo TEXT,
      monto_total_usd REAL NOT NULL,
      persona TEXT NOT NULL CHECK(persona IN ('feli','vale','ambos')),
      fecha_inicio TEXT NOT NULL,
      fecha_limite TEXT,
      nota TEXT,
      activa INTEGER NOT NULL DEFAULT 1,
      origen TEXT,
      cuotas_totales INTEGER,
      frecuencia_dias INTEGER,
      monto_cuota_usd REAL,
      creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )`;
  const DDL_PAGOS = `
    CREATE TABLE pagos_deuda (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deuda_id INTEGER NOT NULL REFERENCES deudas(id) ON DELETE CASCADE,
      fecha TEXT NOT NULL,
      monto_original REAL NOT NULL,
      moneda TEXT NOT NULL CHECK(moneda IN ('USD','VES','EUR','USDT')),
      tasa_usada REAL,
      tasa_tipo TEXT,
      monto_usd REAL NOT NULL,
      cuenta_id INTEGER REFERENCES cuentas(id),
      nota TEXT,
      creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )`;

  if (!(await tablaExiste('deudas'))) {
    await run(DDL_DEUDAS);
    await run(DDL_PAGOS);
  } else if ((await tablaVacia('deudas')) && (await tablaVacia('pagos_deuda'))) {
    await run('DROP TABLE IF EXISTS pagos_deuda');
    await run('DROP TABLE IF EXISTS deudas');
    await run(DDL_DEUDAS);
    await run(DDL_PAGOS);
  } else {
    await agregarColumna('deudas', 'tasa_tipo', 'TEXT');
    await agregarColumna('pagos_deuda', 'tasa_tipo', 'TEXT');
    await agregarColumna('pagos_deuda', 'cuenta_id', 'INTEGER REFERENCES cuentas(id)');
  }

  // Cashea (compra ahora, paga en cuotas): campos opcionales sobre la deuda genérica
  // en vez de un módulo aparte — así aparece junto al resto de las deudas.
  await agregarColumna('deudas', 'origen', 'TEXT');
  await agregarColumna('deudas', 'cuotas_totales', 'INTEGER');
  await agregarColumna('deudas', 'frecuencia_dias', 'INTEGER');
  await agregarColumna('deudas', 'monto_cuota_usd', 'REAL');

  await agregarColumna('movimientos', 'cuenta_id', 'INTEGER REFERENCES cuentas(id)');
  await run('CREATE INDEX IF NOT EXISTS idx_movimientos_cuenta ON movimientos(cuenta_id)');
  await run('CREATE INDEX IF NOT EXISTS idx_pagos_deuda_id ON pagos_deuda(deuda_id)');

  // Config por defecto (solo si la clave todavía no existe).
  for (const [clave, valor] of Object.entries(DEFAULT_CONFIG)) {
    if ((await getConfig(clave)) === undefined) await setConfig(clave, valor);
  }
  // Migración vieja: meta_ahorro_pct suelto -> meta_ahorro.pct
  const metaVieja = await getConfig('meta_ahorro_pct');
  if (metaVieja !== undefined) {
    const actual = (await getConfig('meta_ahorro')) || DEFAULT_CONFIG.meta_ahorro;
    await setConfig('meta_ahorro', { ...actual, pct: metaVieja });
    await run('DELETE FROM config WHERE clave = ?', ['meta_ahorro_pct']);
  }

  // Bolsillos por defecto (solo si no hay ninguno todavía).
  const cuentasExistentes = await get('SELECT COUNT(*) AS c FROM cuentas');
  if (cuentasExistentes.c === 0) {
    for (const c of CUENTAS_INICIALES) {
      await run(
        'INSERT INTO cuentas (nombre, moneda, tipo, orden) VALUES (?, ?, ?, ?)',
        [c.nombre, c.moneda, c.tipo, c.orden]
      );
    }
  }
}

// El esquema se inicializa una sola vez por proceso/contenedor (es idempotente,
// así que da igual si dos invocaciones fría corren esto en paralelo).
let listo = null;
function dbLista() {
  if (!listo) listo = inicializarSchema();
  return listo;
}

module.exports = { get, all, run, exec, dbLista, getConfig, setConfig, columnaExiste, agregarColumna };
