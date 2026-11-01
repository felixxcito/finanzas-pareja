const { get, getConfig } = require('./db');

function pad(n) { return String(n).padStart(2, '0'); }
function fechaLocalHoy() {
  const h = new Date();
  return `${h.getFullYear()}-${pad(h.getMonth() + 1)}-${pad(h.getDate())}`;
}
function mesInterno(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }

// Una quincena por mes: Q1 = días 1-15, Q2 = 16-fin de mes.
function generarQuincenas(mesInicio, mesFin) {
  const [yIni, mIni] = mesInicio.split('-').map(Number);
  const [yFin, mFin] = mesFin.split('-').map(Number);
  const periodos = [];
  let y = yIni, m = mIni;
  while (y < yFin || (y === yFin && m <= mFin)) {
    const mesStr = `${y}-${pad(m)}`;
    const ultimoDia = new Date(y, m, 0).getDate();
    periodos.push({ clave: `${mesStr}-Q1`, mes: mesStr, q: 1, inicio: `${mesStr}-01`, fin: `${mesStr}-15` });
    periodos.push({ clave: `${mesStr}-Q2`, mes: mesStr, q: 2, inicio: `${mesStr}-16`, fin: `${mesStr}-${pad(ultimoDia)}` });
    m++;
    if (m > 12) { m = 1; y++; }
  }
  const hoy = fechaLocalHoy();
  return periodos.filter((p) => p.inicio <= hoy);
}

async function sumaMovimientos(tipo, inicio, fin) {
  const row = await get(
    `SELECT COALESCE(SUM(monto_usd), 0) AS t FROM movimientos WHERE tipo = ? AND fecha BETWEEN ? AND ?`,
    [tipo, inicio, fin]
  );
  return row.t;
}
async function sumaPagosDeuda(inicio, fin) {
  const row = await get(`SELECT COALESCE(SUM(monto_usd), 0) AS t FROM pagos_deuda WHERE fecha BETWEEN ? AND ?`, [inicio, fin]);
  return row.t;
}

async function primeraFechaConDatos() {
  const row = await get(`SELECT MIN(fecha) AS f FROM movimientos`);
  return row.f || null;
}

// Cadena única de quincenas: el faltante de una quincena se suma a la meta de la
// siguiente. La cifra "mensual" es solo la suma de sus dos quincenas — no es una
// segunda cadena, así que un faltante nunca se arrastra dos veces.
async function calcularMetas(hastaMes) {
  const cfg = (await getConfig('meta_ahorro')) || { modo: 'pct', monto_mensual: 200, pct: 20 };
  const hoy = new Date();
  const hastaMesFinal = hastaMes || mesInterno(hoy);
  const primeraFecha = await primeraFechaConDatos();
  const mesInicio = primeraFecha ? primeraFecha.slice(0, 7) : hastaMesFinal;

  const periodos = generarQuincenas(mesInicio <= hastaMesFinal ? mesInicio : hastaMesFinal, hastaMesFinal);

  let arrastre = 0;
  const quincenas = [];
  // Secuencial a propósito: el arrastre de cada quincena depende de la anterior,
  // no se puede paralelizar sin romper el orden cronológico.
  for (const p of periodos) {
    const ingresos = await sumaMovimientos('ingreso', p.inicio, p.fin);
    const gastos = await sumaMovimientos('gasto', p.inicio, p.fin);
    const pagosDeuda = await sumaPagosDeuda(p.inicio, p.fin);
    const ahorrado = ingresos - gastos - pagosDeuda;
    const base = cfg.modo === 'monto' ? cfg.monto_mensual / 2 : ingresos * (cfg.pct / 100);
    const arrastreEntrante = arrastre;
    const metaEfectiva = base + arrastreEntrante;
    const faltante = Math.max(0, metaEfectiva - ahorrado);
    quincenas.push({
      clave: p.clave, mes: p.mes, quincena: p.q, inicio: p.inicio, fin: p.fin,
      ingresos, gastos, pago_deuda: pagosDeuda, ahorrado,
      meta_base: base, arrastre_entrante: arrastreEntrante, meta_efectiva: metaEfectiva,
      cumplida: ahorrado >= metaEfectiva - 0.01, faltante
    });
    arrastre = faltante;
  }

  const porMes = new Map();
  for (const q of quincenas) {
    if (!porMes.has(q.mes)) porMes.set(q.mes, { mes: q.mes, ingresos: 0, gastos: 0, pago_deuda: 0, ahorrado: 0, meta_efectiva: 0, quincenas: [] });
    const acc = porMes.get(q.mes);
    acc.ingresos += q.ingresos;
    acc.gastos += q.gastos;
    acc.pago_deuda += q.pago_deuda;
    acc.ahorrado += q.ahorrado;
    acc.meta_efectiva += q.meta_efectiva;
    acc.quincenas.push(q.clave);
  }
  const meses = [...porMes.values()].map((m) => ({ ...m, cumplida: m.ahorrado >= m.meta_efectiva - 0.01, faltante: Math.max(0, m.meta_efectiva - m.ahorrado) }));

  return { config: cfg, quincenas, meses, arrastre_actual: arrastre };
}

module.exports = { calcularMetas };
