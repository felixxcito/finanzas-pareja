const https = require('node:https');
const { get, run, getConfig, setConfig } = require('./db');

function httpJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (dashboard-finanzas-local)',
        ...options.headers
      },
      timeout: 8000
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(new Error('Respuesta no-JSON de ' + url));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (options.body) req.write(JSON.stringify(options.body));
    req.end();
  });
}

async function fetchDolarApi() {
  const [dolares, euros] = await Promise.all([
    httpJson('https://ve.dolarapi.com/v1/dolares'),
    httpJson('https://ve.dolarapi.com/v1/euros')
  ]);
  const find = (arr, fuente) => arr.find((x) => x.fuente === fuente)?.promedio ?? null;
  return {
    bcv_usd: find(dolares, 'oficial'),
    paralelo_usd: find(dolares, 'paralelo'),
    bcv_eur: find(euros, 'oficial'),
    paralelo_eur: find(euros, 'paralelo'),
    fecha_fuente: dolares.find((x) => x.fuente === 'oficial')?.fechaActualizacion ?? null
  };
}

async function fetchBinanceP2PSide(tradeType) {
  const body = { asset: 'USDT', fiat: 'VES', tradeType, page: 1, rows: 10, payTypes: [] };
  const json = await httpJson('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', { method: 'POST', body });
  const ads = (json.data || []).map((x) => parseFloat(x.adv.price)).filter((n) => !Number.isNaN(n));
  if (!ads.length) return null;
  const top = ads.slice(0, 5);
  return top.reduce((a, b) => a + b, 0) / top.length;
}

async function fetchBinanceP2P() {
  const [compra, venta] = await Promise.all([
    fetchBinanceP2PSide('BUY').catch(() => null),
    fetchBinanceP2PSide('SELL').catch(() => null)
  ]);
  return { usdt_compra: compra, usdt_venta: venta };
}

const CACHE_MS = 5 * 60 * 1000;

// El caché vive en la tabla `config` (no en una variable en memoria): en Vercel cada
// invocación puede correr en un contenedor distinto, así que una variable de módulo
// se perdería entre requests casi siempre y terminaríamos golpeando las APIs externas
// en cada carga de la página.
async function obtenerTasas(forzar = false) {
  const ahora = Date.now();
  if (!forzar) {
    const cache = await getConfig('tasas_cache');
    if (cache && ahora - cache.timestamp < CACHE_MS) {
      return { ...cache.data, desde_cache: true };
    }
  }

  let dolarApiData = {};
  let binanceData = {};
  let errores = [];

  try {
    dolarApiData = await fetchDolarApi();
  } catch (err) {
    errores.push('BCV/Euro: ' + err.message);
  }

  try {
    binanceData = await fetchBinanceP2P();
  } catch (err) {
    errores.push('USDT P2P: ' + err.message);
  }

  const usdt_compra = binanceData.usdt_compra ?? null;
  const usdt_venta = binanceData.usdt_venta ?? null;
  const usdt_promedio = usdt_compra && usdt_venta ? (usdt_compra + usdt_venta) / 2 : (usdt_compra || usdt_venta);

  const tasaEfectivoManual = await getConfig('tasa_efectivo_manual');

  const resultado = {
    fecha: new Date().toISOString(),
    fecha_fuente_bcv: dolarApiData.fecha_fuente || null,
    bcv: { usd: dolarApiData.bcv_usd ?? null, eur: dolarApiData.bcv_eur ?? null },
    paralelo: { usd: dolarApiData.paralelo_usd ?? null, eur: dolarApiData.paralelo_eur ?? null },
    usdt: { compra: usdt_compra, venta: usdt_venta, promedio: usdt_promedio },
    tasa_efectivo_sugerida: usdt_promedio,
    tasa_efectivo_manual: tasaEfectivoManual,
    tasa_efectivo: tasaEfectivoManual ?? usdt_promedio,
    errores,
    desde_cache: false
  };

  await setConfig('tasas_cache', { data: resultado, timestamp: ahora });

  // Guarda como máximo un punto cada 30 min (si no, cada refresco de la pestaña
  // durante horas de uso llenaría el historial de puntos casi idénticos).
  const ultimaFila = await get('SELECT fecha FROM tasas_historial ORDER BY id DESC LIMIT 1');
  const debeGuardar = !ultimaFila || (ahora - new Date(ultimaFila.fecha.replace(' ', 'T')).getTime()) > 30 * 60 * 1000;

  if (debeGuardar && (dolarApiData.bcv_usd || usdt_promedio)) {
    await run(
      `INSERT INTO tasas_historial (bcv_usd, bcv_eur, paralelo_usd, paralelo_eur, usdt_compra, usdt_venta)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        dolarApiData.bcv_usd ?? null,
        dolarApiData.bcv_eur ?? null,
        dolarApiData.paralelo_usd ?? null,
        dolarApiData.paralelo_eur ?? null,
        usdt_compra ?? null,
        usdt_venta ?? null
      ]
    );
  }

  return resultado;
}

// Traduce una etiqueta de tasa ('bcv' | 'paralelo' | 'usdt' | 'efectivo') a un número,
// según la moneda. Centralizado para que movimientos, pagos de deuda, deudas y cambios
// usen siempre la misma lógica (antes cada uno la repetía distinto, y EUR usaba por
// error una tasa de USD cuando se elegía 'efectivo' o 'usdt').
function resolverTasa(tasaTipo, moneda, tasas) {
  if (moneda === 'EUR') {
    // 'efectivo' y 'usdt' no existen en euros: no manejan efectivo en EUR ni USDT/EUR.
    if (tasaTipo === 'paralelo') return tasas.paralelo.eur;
    return tasas.bcv.eur;
  }
  if (tasaTipo === 'bcv') return tasas.bcv.usd;
  if (tasaTipo === 'paralelo') return tasas.paralelo.usd;
  if (tasaTipo === 'usdt') return tasas.usdt.promedio;
  return tasas.tasa_efectivo;
}

// tasaUsada = tasa de cambio aplicada a ESTA transacción (VES por 1 USD si moneda=VES,
// o VES por 1 EUR si moneda=EUR). El monto en USD/USDT no necesita tasa (se cuenta 1:1).
function convertirAUsd(monto, moneda, tasaUsada, tasas) {
  monto = parseFloat(monto);
  if (moneda === 'USD' || moneda === 'USDT') return monto;
  if (!tasaUsada || tasaUsada <= 0) throw new Error('Falta la tasa de cambio para convertir ' + moneda);
  if (moneda === 'VES') return monto / tasaUsada;
  if (moneda === 'EUR') {
    const tasaUsdVes = tasas?.bcv?.usd || tasas?.tasa_efectivo;
    if (!tasaUsdVes) throw new Error('No hay tasa USD/VES disponible para convertir el EUR');
    return (monto * tasaUsada) / tasaUsdVes;
  }
  throw new Error('Moneda no soportada: ' + moneda);
}

module.exports = { obtenerTasas, convertirAUsd, resolverTasa };
