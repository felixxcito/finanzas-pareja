const MESES_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const FREQ_MULT = { semanal: 4, quincenal: 2, mensual: 1 };
const FREQ_LABEL = { semanal: 'semana', quincenal: 'quincena', mensual: 'mes' };

let CONFIG = null;
let TASAS = null;
let CUENTAS = [];
let MES_INICIO = formatoMes(new Date());
let MES_GASTOS = formatoMes(new Date());
let MES_INGRESOS = formatoMes(new Date());

// ---------- Fechas ----------
function formatoMes(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
// Fecha de HOY en hora local (no usar toISOString: es UTC y en Venezuela, de noche,
// se adelanta un día — bug real que existía en el formulario).
function fechaHoyLocal() {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}-${String(h.getDate()).padStart(2, '0')}`;
}
function etiquetaMes(mes) { const [y, m] = mes.split('-').map(Number); return `${MESES_ES[m - 1].slice(0, 3)} ${y}`; }
function etiquetaMesLargo(mes) { const [y, m] = mes.split('-').map(Number); return `${MESES_ES[m - 1]} ${y}`; }
function fmtFecha(f) { const [y, m, d] = f.split('-'); return `${d}/${m}/${y}`; }
function mesesRecientes(n) {
  const out = []; const hoy = new Date();
  for (let i = 0; i < n; i++) out.push(formatoMes(new Date(hoy.getFullYear(), hoy.getMonth() - i, 1)));
  return out;
}
function llenarSelectorMeses(select, mesSeleccionado, onChange) {
  select.innerHTML = mesesRecientes(12).map((m) => `<option value="${m}">${etiquetaMesLargo(m)}</option>`).join('');
  select.value = mesSeleccionado;
  select.onchange = () => onChange(select.value);
}

// ---------- Formato / seguridad ----------
function fmtUsd(n) {
  const v = n ?? 0;
  const signo = v < 0 ? '-' : '';
  return signo + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
// Texto extra para una fila: la tasa usada para convertir (VES/EUR), o si un monto
// en USD/USDT se anotó como "cambiado a bolívares", el equivalente en Bs.
function detalleTasa(mov) {
  if (!mov.tasa_usada) return '';
  if (mov.moneda === 'VES' || mov.moneda === 'EUR') return ` @ ${Number(mov.tasa_usada).toFixed(2)}`;
  const bs = mov.monto_original * mov.tasa_usada;
  return ` · cambiado a ${Number(mov.tasa_usada).toFixed(2)} Bs/USD (≈ ${fmtMoneda(bs, 'VES')})`;
}
function fmtMoneda(n, moneda) {
  const v = n ?? 0;
  const signo = v < 0 ? '-' : '';
  const abs = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (moneda === 'VES') return `${signo}Bs. ${abs}`;
  if (moneda === 'USDT') return `${signo}${abs} USDT`;
  return `${signo}$${abs}`;
}
function nombreDe(persona) {
  if (persona === 'ambos') return 'Ambos';
  return CONFIG?.nombres?.[persona] || persona;
}
// Nota/categoría/nombre son texto que la pareja escribe libremente — sin esto,
// algo como <img onerror=...> escrito en una nota se ejecutaría al mostrarlo.
function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function icon(name, cls = '') { return `<svg class="icon ${cls}"><use href="#icon-${name}"/></svg>`; }
function estadoVacio(nombreIcono, mensaje) { return `<div class="vacio">${icon(nombreIcono)}${escapeHtml(mensaje)}</div>`; }

// ---------- Animación ----------
function animarNumero(el, valorFinal, { prefijo = '', decimales = 2, duracion = 650 } = {}) {
  if (!el) return;
  const signo = valorFinal < 0 ? '-' : '';
  const absFinal = Math.abs(valorFinal || 0);
  if (document.hidden) {
    el.textContent = signo + prefijo + absFinal.toLocaleString('en-US', { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
    return;
  }
  const t0 = performance.now();
  function paso(t) {
    const p = Math.min(1, (t - t0) / duracion);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = signo + prefijo + (absFinal * eased).toLocaleString('en-US', { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
    if (p < 1) requestAnimationFrame(paso);
  }
  requestAnimationFrame(paso);
}
function animarEntrada(containerId) {
  const cont = document.getElementById(containerId);
  if (!cont) return;
  [...cont.children].forEach((el, i) => { el.classList.add('entrar'); el.style.animationDelay = (i * 0.06) + 's'; });
}
function badgeTendencia(actual, anterior, invertido = false) {
  if (anterior === undefined || anterior === null || anterior === 0) return `<span class="badge-tendencia neutro">sin datos previos</span>`;
  const cambio = ((actual - anterior) / Math.abs(anterior)) * 100;
  const positivo = invertido ? cambio <= 0 : cambio >= 0;
  const cls = Math.abs(cambio) < 0.5 ? 'neutro' : (positivo ? 'positivo' : 'negativo');
  const ic = cambio >= 0 ? 'up' : 'down';
  return `<span class="badge-tendencia ${cls}">${icon(ic)}${Math.abs(cambio).toFixed(0)}%</span>`;
}
function mostrarToast(mensaje) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = mensaje;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('visible'));
  setTimeout(() => { el.classList.remove('visible'); setTimeout(() => el.remove(), 300); }, 2600);
}

// ---------- Navegación ----------
document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('activo'));
    document.querySelectorAll('.vista').forEach((v) => v.classList.remove('activa'));
    btn.classList.add('activo');
    document.getElementById('vista-' + btn.dataset.vista).classList.add('activa');
    ({
      inicio: cargarInicio, gastos: cargarGastos, ingresos: cargarIngresos,
      bolsillos: cargarBolsillos, deudas: cargarDeudas, inversion: cargarInversion,
      ahorro: cargarAhorro, ajustes: cargarAjustes
    })[btn.dataset.vista]?.();
  });
});

// ---------- Modal genérico (con Escape, botón cerrar y sin condición de carrera) ----------
let modalTimeoutId = null;
function escuchaEscape(e) { if (e.key === 'Escape') cerrarModal(); }
function abrirModal(html) {
  if (modalTimeoutId) { clearTimeout(modalTimeoutId); modalTimeoutId = null; }
  document.getElementById('modal-contenido').innerHTML = `<button type="button" class="modal-cerrar" onclick="cerrarModal()" aria-label="Cerrar">${icon('x')}</button>` + html;
  document.getElementById('modal-fondo').classList.add('abierto');
  document.addEventListener('keydown', escuchaEscape);
  setTimeout(() => document.querySelector('#modal-contenido input, #modal-contenido select')?.focus(), 60);
}
function cerrarModal() {
  document.getElementById('modal-fondo').classList.remove('abierto');
  document.removeEventListener('keydown', escuchaEscape);
  modalTimeoutId = setTimeout(() => { document.getElementById('modal-contenido').innerHTML = ''; modalTimeoutId = null; }, 220);
}
document.getElementById('modal-fondo').addEventListener('click', (e) => { if (e.target.id === 'modal-fondo') cerrarModal(); });

// Envuelve un submit: previene el default, deshabilita el botón, y si algo falla
// (ej. el servidor rechaza la tasa faltante) muestra el error en vez de dejar el
// modal como si no hubiera pasado nada.
function manejarEnvio(formEl, handler) {
  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = formEl.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    try {
      await handler();
    } catch (err) {
      mostrarToast(err.message || 'Ocurrió un error');
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}

// ---------- Bolsillos (cache) ----------
async function cargarCuentasCache() { CUENTAS = await Api.cuentas(); return CUENTAS; }
function cuentaPorId(id) { return CUENTAS.find((c) => c.id === Number(id)); }
function opcionesCuenta(actualId) {
  return CUENTAS.filter((c) => c.activa).map((c) => `<option value="${c.id}" ${Number(actualId) === c.id ? 'selected' : ''}>${escapeHtml(c.nombre)} (${c.moneda})</option>`).join('');
}
function iconoDeCuenta(tipo) {
  return { efectivo: 'cash', zelle: 'bank', usdt: 'coin', bolivares: 'wallet' }[tipo] || 'wallet';
}

// ---------- Opciones comunes de formulario ----------
function opcionesCategoria(actual) {
  return CONFIG.categorias_gasto.map((c) => `<option value="${escapeHtml(c)}" ${c === actual ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');
}
function opcionesPersona(actual) {
  const opts = [['feli', nombreDe('feli')], ['vale', nombreDe('vale')], ['ambos', 'Ambos']];
  return opts.map(([v, l]) => `<option value="${v}" ${v === actual ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('');
}
function opcionesMoneda(actual, incluirUsdt = true) {
  const monedas = ['USD', 'VES', 'EUR']; if (incluirUsdt) monedas.push('USDT');
  return monedas.map((m) => `<option value="${m}" ${m === actual ? 'selected' : ''}>${m}</option>`).join('');
}
function bloqueTasaTipo(idPrefix) {
  const p = idPrefix;
  return `
    <div class="campo campo-tasa" id="${p}-bloque-tasa" style="display:none">
      <label>¿Qué tasa usaron?</label>
      <select id="${p}-tasa-tipo">
        <option value="efectivo">Tasa del efectivo (${TASAS?.tasa_efectivo ? TASAS.tasa_efectivo.toFixed(2) : '--'})</option>
        <option value="bcv">BCV oficial</option>
        <option value="paralelo">Paralelo</option>
        <option value="usdt">USDT P2P promedio</option>
        <option value="manual">Otra tasa (la pongo yo)</option>
      </select>
      <input type="number" step="0.01" min="0" id="${p}-tasa-manual" placeholder="Ej: la tasa con la que te pagaron" style="display:none; margin-top:8px;">
    </div>`;
}
// Para bolsillos en USD/USDT: no hace falta tasa para la contabilidad, pero se puede
// anotar que ESE monto en particular se cambió a bolívares, con la tasa de ese cambio.
function bloqueCambioOpcional(idPrefix) {
  const p = idPrefix;
  return `
    <div class="campo campo-cambio-opcional" id="${p}-bloque-cambio" style="display:none">
      <label class="check-linea">
        <input type="checkbox" id="${p}-se-cambio">
        ¿Ese monto se cambió a bolívares?
      </label>
      <div id="${p}-cambio-detalle" style="display:none; margin-top:8px;">
        <input type="number" step="0.01" min="0" id="${p}-cambio-tasa" placeholder="Tasa a la que se cambió (Bs. por USD)">
        <div class="detalle" id="${p}-cambio-equivalente"></div>
      </div>
    </div>`;
}
function activarBloqueTasaTipo(idPrefix) {
  const p = idPrefix;
  const sel = document.getElementById(p + '-tasa-tipo');
  const manual = document.getElementById(p + '-tasa-manual');
  if (!sel) return;
  sel.addEventListener('change', () => { manual.style.display = sel.value === 'manual' ? 'block' : 'none'; });
}
function activarBloqueCambioOpcional(idPrefix) {
  const p = idPrefix;
  const chk = document.getElementById(p + '-se-cambio');
  const detalle = document.getElementById(p + '-cambio-detalle');
  const tasaInput = document.getElementById(p + '-cambio-tasa');
  const equivalente = document.getElementById(p + '-cambio-equivalente');
  if (!chk) return;
  chk.addEventListener('change', () => { detalle.style.display = chk.checked ? 'block' : 'none'; actualizarEquivalente(); });
  const actualizarEquivalente = () => {
    const monto = Number(document.getElementById(p + '-monto')?.value || 0);
    const tasa = Number(tasaInput.value || 0);
    equivalente.textContent = monto > 0 && tasa > 0 ? `≈ ${fmtMoneda(monto * tasa, 'VES')}` : '';
  };
  tasaInput.addEventListener('input', actualizarEquivalente);
  document.getElementById(p + '-monto')?.addEventListener('input', actualizarEquivalente);
}
// Para deudas: el bloque de tasa depende del <select> de MONEDA (no hay bolsillo).
function activarToggleTasa(idPrefix) {
  const sel = document.getElementById(idPrefix + '-moneda');
  const bloque = document.getElementById(idPrefix + '-bloque-tasa');
  const actualizar = () => { bloque.style.display = (sel.value === 'VES' || sel.value === 'EUR') ? 'block' : 'none'; };
  sel.addEventListener('change', actualizar);
  activarBloqueTasaTipo(idPrefix);
  actualizar();
}
// Para gasto/ingreso/pago/inversión: el bloque depende del BOLSILLO elegido — tasa
// obligatoria si el bolsillo es en bolívares, y opcional (anotación) si es en USD/USDT.
function activarToggleTasaCuenta(idPrefix) {
  const sel = document.getElementById(idPrefix + '-cuenta');
  const bloqueTasa = document.getElementById(idPrefix + '-bloque-tasa');
  const bloqueCambio = document.getElementById(idPrefix + '-bloque-cambio');
  const actualizar = () => {
    const c = cuentaPorId(sel.value);
    bloqueTasa.style.display = c && c.moneda === 'VES' ? 'block' : 'none';
    if (bloqueCambio) bloqueCambio.style.display = c && (c.moneda === 'USD' || c.moneda === 'USDT') ? 'block' : 'none';
  };
  sel.addEventListener('change', actualizar);
  activarBloqueTasaTipo(idPrefix);
  activarBloqueCambioOpcional(idPrefix);
  actualizar();
}
// Lee el bloque de tasa que esté visible para este formulario (VES obligatoria,
// o el check opcional de "se cambió a bolívares" en un bolsillo USD/USDT).
function leerTasaFormulario(idPrefix) {
  const p = idPrefix;
  const bloqueTasa = document.getElementById(p + '-bloque-tasa');
  if (bloqueTasa && bloqueTasa.style.display !== 'none') {
    const tipo = document.getElementById(p + '-tasa-tipo').value;
    if (tipo === 'manual') {
      const v = document.getElementById(p + '-tasa-manual').value;
      return { tasa_tipo: 'manual', tasa_usada: v ? Number(v) : undefined };
    }
    return { tasa_tipo: tipo, tasa_usada: undefined };
  }
  const chk = document.getElementById(p + '-se-cambio');
  if (chk && chk.checked) {
    const v = document.getElementById(p + '-cambio-tasa').value;
    return { tasa_tipo: 'manual', tasa_usada: v ? Number(v) : undefined };
  }
  return { tasa_tipo: undefined, tasa_usada: undefined };
}

// ---------- Fotos de facturas ----------
function bloqueAdjunto(idPrefix) {
  return `
    <div class="campo">
      <label>Foto de la factura (opcional)</label>
      <input type="file" accept="image/*" capture="environment" id="${idPrefix}-foto">
      <div class="preview-foto" id="${idPrefix}-foto-preview" hidden></div>
    </div>`;
}
// maxLado/calidad bajos a propósito: el servidor solo acepta hasta 2.5MB ya
// decodificados (Vercel corta el body de una función en 4.5MB, y en base64 la
// imagen pesa ~33% más). Con esto una foto de recibo normal entra sin problema.
function prepararFoto(file, maxLado = 1280, calidad = 0.72) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onerror = () => reject(new Error('No se pudo leer la foto'));
    lector.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('No se pudo leer la foto'));
      img.onload = () => {
        const escala = Math.min(1, maxLado / Math.max(img.width, img.height));
        const w = Math.round(img.width * escala), h = Math.round(img.height * escala);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', calidad));
      };
      img.src = lector.result;
    };
    lector.readAsDataURL(file);
  });
}
function activarPreviewFoto(idPrefix) {
  const input = document.getElementById(idPrefix + '-foto');
  const preview = document.getElementById(idPrefix + '-foto-preview');
  if (!input) return;
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) { preview.hidden = true; delete input.dataset.dataUrl; return; }
    try {
      const dataUrl = await prepararFoto(file);
      input.dataset.dataUrl = dataUrl;
      preview.hidden = false;
      preview.innerHTML = `<img src="${dataUrl}" alt="vista previa de la factura">`;
    } catch (err) { mostrarToast(err.message); }
  });
}
async function subirAdjuntoSiHay(idPrefix, entidad, entidadId) {
  const input = document.getElementById(idPrefix + '-foto');
  if (input && input.dataset.dataUrl) {
    await Api.subirAdjunto({ entidad, entidad_id: entidadId, nombre_original: input.files[0]?.name || null, data_url: input.dataset.dataUrl });
  }
}
function renderMiniaturas(adjuntos) {
  if (!adjuntos || !adjuntos.length) return '';
  return `<div class="miniaturas" style="display:flex;gap:4px;margin-top:6px;">${adjuntos.map((a) =>
    `<img class="miniatura-adjunto" src="${Api.urlAdjunto(a.id)}" alt="factura" onclick="verFotoGrande('${Api.urlAdjunto(a.id)}')">`
  ).join('')}</div>`;
}
function verFotoGrande(url) {
  const div = document.createElement('div');
  div.className = 'lightbox-fondo';
  div.innerHTML = `<img src="${url}" alt="factura">`;
  div.addEventListener('click', () => div.remove());
  document.body.appendChild(div);
}

// ========================================================================
// INICIO
// ========================================================================
async function cargarInicio() {
  llenarSelectorMeses(document.getElementById('selector-mes-inicio'), MES_INICIO, (v) => { MES_INICIO = v; cargarInicio(); });
  const hoy = new Date();
  document.getElementById('fecha-hoy').textContent = hoy.toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  await renderTasas();

  const historial = await Api.historialResumen(6, MES_INICIO);
  const r = historial[historial.length - 1];
  renderResumenInicio(historial);
  renderPrediccion(r);
  Charts.categorias('chart-categorias', r.gasto_por_categoria);

  const movs = await Api.movimientos({ mes: MES_INICIO });
  renderUltimosMovimientos(movs.slice(0, 8));

  Charts.tendencia('chart-tendencia', historial.map((h) => etiquetaMes(h.mes)), historial.map((h) => h.ingreso_total), historial.map((h) => h.gasto_total));
}

async function renderTasas(forzar = false) {
  TASAS = await Api.tasas(forzar);
  const cont = document.getElementById('tarjetas-tasas');
  cont.innerHTML = `
    <div class="tarjeta-tasa">
      <div class="tasa-encabezado"><span class="tasa-icono">${icon('bank')}</span><span class="etiqueta">BCV Dólar</span></div>
      <div class="valor-cifra">${TASAS.bcv.usd ? TASAS.bcv.usd.toFixed(2) : '--'}<small>Bs.</small></div>
      <div class="detalle">Paralelo: ${TASAS.paralelo.usd ? TASAS.paralelo.usd.toFixed(2) : '--'} Bs.</div>
    </div>
    <div class="tarjeta-tasa">
      <div class="tasa-encabezado"><span class="tasa-icono">${icon('euro')}</span><span class="etiqueta">BCV Euro</span></div>
      <div class="valor-cifra">${TASAS.bcv.eur ? TASAS.bcv.eur.toFixed(2) : '--'}<small>Bs.</small></div>
      <div class="detalle">Paralelo: ${TASAS.paralelo.eur ? TASAS.paralelo.eur.toFixed(2) : '--'} Bs.</div>
    </div>
    <div class="tarjeta-tasa">
      <div class="tasa-encabezado"><span class="tasa-icono">${icon('coin')}</span><span class="etiqueta">USDT P2P</span></div>
      <div class="valor-cifra">${TASAS.usdt.promedio ? TASAS.usdt.promedio.toFixed(2) : '--'}<small>Bs.</small></div>
      <div class="detalle">Compra ${TASAS.usdt.compra?.toFixed(2) ?? '--'} · Venta ${TASAS.usdt.venta?.toFixed(2) ?? '--'} · <a href="#" id="link-refrescar-tasas">refrescar</a></div>
    </div>
    <div class="tarjeta-tasa editable">
      <div class="tasa-encabezado"><span class="tasa-icono">${icon('cash')}</span><span class="etiqueta">Tasa del efectivo</span></div>
      <div class="tasa-editar-fila">
        <input type="number" step="0.01" id="input-tasa-efectivo" value="${TASAS.tasa_efectivo ? TASAS.tasa_efectivo.toFixed(2) : ''}">
        <button class="btn btn-chico btn-primario" id="btn-guardar-tasa-efectivo">Guardar</button>
      </div>
      <div class="detalle">Se actualiza manualmente · sugerido: ${TASAS.tasa_efectivo_sugerida ? TASAS.tasa_efectivo_sugerida.toFixed(2) : '--'} · <a href="#" id="link-copiar-sugerida">copiar</a></div>
    </div>
  `;
  document.getElementById('link-refrescar-tasas').addEventListener('click', (e) => { e.preventDefault(); renderTasas(true); });
  document.getElementById('link-copiar-sugerida').addEventListener('click', (e) => {
    e.preventDefault();
    if (TASAS.tasa_efectivo_sugerida) document.getElementById('input-tasa-efectivo').value = TASAS.tasa_efectivo_sugerida.toFixed(2);
  });
  document.getElementById('btn-guardar-tasa-efectivo').addEventListener('click', async () => {
    const valor = Number(document.getElementById('input-tasa-efectivo').value);
    if (!valor || valor <= 0) { mostrarToast('Pon un número válido'); return; }
    try {
      await Api.guardarConfig({ tasa_efectivo_manual: valor });
      mostrarToast('Tasa del efectivo guardada');
      renderTasas(true);
    } catch (err) { mostrarToast(err.message); }
  });
  animarEntrada('tarjetas-tasas');
}

function renderResumenInicio(historial) {
  const r = historial[historial.length - 1];
  const rPrev = historial.length > 1 ? historial[historial.length - 2] : null;
  const cont = document.getElementById('tarjetas-resumen');
  cont.innerHTML = `
    <div class="tarjeta">
      <div class="stat-cabecera"><span class="stat-label">Ingresos del mes</span>${badgeTendencia(r.ingreso_total, rPrev?.ingreso_total)}</div>
      <div class="stat-valor verde" id="cifra-ingreso">$0.00</div>
      <div class="stat-sub">${escapeHtml(nombreDe('feli'))}: ${fmtUsd(r.ingreso_feli)} · ${escapeHtml(nombreDe('vale'))}: ${fmtUsd(r.ingreso_vale)}</div>
      <div class="grafico sparkline"><canvas id="spark-ingreso"></canvas></div>
    </div>
    <div class="tarjeta">
      <div class="stat-cabecera"><span class="stat-label">Gastos del mes</span>${badgeTendencia(r.gasto_total, rPrev?.gasto_total, true)}</div>
      <div class="stat-valor rojo" id="cifra-gasto">$0.00</div>
      <div class="stat-sub">${r.cantidad_gastos} gasto${r.cantidad_gastos === 1 ? '' : 's'} registrados</div>
      <div class="grafico sparkline"><canvas id="spark-gasto"></canvas></div>
    </div>
    <div class="tarjeta">
      <div class="stat-cabecera"><span class="stat-label">Ahorro real</span>${badgeTendencia(r.ahorro_real, rPrev?.ahorro_real)}</div>
      <div class="stat-valor ${r.diferencia_ahorro >= 0 ? 'verde' : 'rojo'}" id="cifra-ahorro">$0.00</div>
      <div class="stat-sub">Meta: ${fmtUsd(r.ahorro_sugerido)}</div>
      <div class="grafico sparkline"><canvas id="spark-ahorro"></canvas></div>
    </div>
    <div class="tarjeta">
      <div class="stat-cabecera"><span class="stat-label">Deuda pendiente</span></div>
      <div class="stat-valor" id="cifra-deuda">$0.00</div>
      <div class="stat-sub">${r.dia_actual ? 'Mes en curso' : 'Mes cerrado'}</div>
    </div>
  `;
  animarNumero(document.getElementById('cifra-ingreso'), r.ingreso_total, { prefijo: '$' });
  animarNumero(document.getElementById('cifra-gasto'), r.gasto_total, { prefijo: '$' });
  animarNumero(document.getElementById('cifra-ahorro'), r.ahorro_real, { prefijo: '$' });
  animarNumero(document.getElementById('cifra-deuda'), r.deuda_pendiente_total, { prefijo: '$' });
  animarEntrada('tarjetas-resumen');
  Charts.sparkline('spark-ingreso', historial.map((h) => h.ingreso_total), PALETA.success);
  Charts.sparkline('spark-gasto', historial.map((h) => h.gasto_total), PALETA.danger);
  Charts.sparkline('spark-ahorro', historial.map((h) => h.ahorro_real), PALETA.accent);
}

function renderPrediccion(r) {
  const cont = document.getElementById('tarjeta-prediccion');
  if (!r.dia_actual) {
    cont.innerHTML = `<div class="tarjeta-titulo"><h3>Proyección de fin de mes</h3></div><p class="texto-explicativo">Ese mes ya cerró, así que no aplica proyección — solo aplica al mes en curso.</p>`;
    return;
  }
  const pctIngreso = r.ingreso_total > 0 ? (r.proyeccion_gasto_fin_mes / r.ingreso_total) * 100 : null;
  const avance = Math.min(100, (r.dia_actual / r.dias_del_mes) * 100);
  cont.innerHTML = `
    <div class="tarjeta-titulo">
      <h3>Proyección de fin de mes</h3>
      <span class="tarjeta-subtitulo">Día ${r.dia_actual} de ${r.dias_del_mes} · combina su ritmo actual con el promedio de los últimos meses</span>
    </div>
    <div class="grid grid-3">
      <div>
        <div class="stat-label">Si siguen así, terminarán gastando</div>
        <div class="stat-valor rojo" id="pred-gasto">$0.00</div>
        <div class="stat-sub">${pctIngreso !== null ? pctIngreso.toFixed(0) + '% de lo que ganan este mes' : 'aún sin ingresos registrados'}</div>
      </div>
      <div>
        <div class="stat-label">Promedio de los últimos 3 meses</div>
        <div class="stat-valor" id="pred-promedio">${r.promedio_gasto_historico !== null ? '$0.00' : '—'}</div>
        <div class="stat-sub">${r.promedio_gasto_historico !== null ? 'les sirve de referencia' : 'aún no hay suficiente historial'}</div>
      </div>
      <div>
        <div class="stat-label">Avance del mes</div>
        <div class="stat-valor">${avance.toFixed(0)}%</div>
        <div class="barra-progreso"><div class="lleno" style="width:${avance}%"></div></div>
      </div>
    </div>
  `;
  animarNumero(document.getElementById('pred-gasto'), r.proyeccion_gasto_fin_mes, { prefijo: '$' });
  if (r.promedio_gasto_historico !== null) animarNumero(document.getElementById('pred-promedio'), r.promedio_gasto_historico, { prefijo: '$' });
}

function renderUltimosMovimientos(movs) {
  const cont = document.getElementById('lista-ultimos');
  if (!movs.length) { cont.innerHTML = estadoVacio('receipt', 'Aún no hay movimientos este mes'); return; }
  cont.innerHTML = movs.map((m) => `
    <div class="fila">
      <div class="info">
        <span class="principal">${escapeHtml(m.tipo === 'gasto' ? (m.categoria || 'Gasto') : 'Ingreso')} · ${escapeHtml(nombreDe(m.persona))}</span>
        <span class="secundario">${fmtFecha(m.fecha)}${m.nota ? ' · ' + escapeHtml(m.nota) : ''}</span>
      </div>
      <div class="monto ${m.tipo}">${m.tipo === 'gasto' ? '-' : '+'}${fmtUsd(m.monto_usd)}</div>
    </div>
  `).join('');
  animarEntrada('lista-ultimos');
}

// ========================================================================
// GASTOS
// ========================================================================
async function cargarGastos() {
  llenarSelectorMeses(document.getElementById('filtro-mes-gastos'), MES_GASTOS, (v) => { MES_GASTOS = v; cargarGastos(); });

  // Antes: se leía selCat.value DESPUÉS de reconstruir sus <option>, que lo resetea
  // a "" — el filtro de categoría nunca filtraba. Ahora se preserva la selección.
  const selCat = document.getElementById('filtro-categoria-gastos');
  const categoriaPrevia = selCat.value;
  selCat.innerHTML = '<option value="">Todas las categorías</option>' + CONFIG.categorias_gasto.map((c) => `<option value="${escapeHtml(c)}" ${c === categoriaPrevia ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');

  const persona = document.getElementById('filtro-persona-gastos').value;
  const categoria = selCat.value;
  const query = { mes: MES_GASTOS, tipo: 'gasto' };
  if (persona) query.persona = persona;
  if (categoria) query.categoria = categoria;
  const gastos = await Api.movimientos(query);
  const cont = document.getElementById('lista-gastos');
  if (!gastos.length) { cont.innerHTML = estadoVacio('receipt', 'No hay gastos con esos filtros'); return; }
  cont.innerHTML = gastos.map((g) => {
    const cuenta = cuentaPorId(g.cuenta_id);
    return `
    <div class="fila">
      <div class="info">
        <span class="principal">${escapeHtml(g.categoria || 'Otros')} · <span class="pill">${escapeHtml(nombreDe(g.persona))}</span></span>
        <span class="secundario">${fmtFecha(g.fecha)} · ${g.monto_original} ${g.moneda}${cuenta ? ' · ' + escapeHtml(cuenta.nombre) : ''}${detalleTasa(g)}${g.nota ? ' · ' + escapeHtml(g.nota) : ''}</span>
        ${renderMiniaturas(g.adjuntos)}
      </div>
      <div class="monto gasto">-${fmtUsd(g.monto_usd)}</div>
      <div class="acciones"><button class="btn btn-chico btn-icono btn-peligro" onclick="borrarGasto(${g.id})">${icon('trash')}</button></div>
    </div>
  `;
  }).join('');
  animarEntrada('lista-gastos');
}

async function borrarGasto(id) {
  if (!confirm('¿Borrar este gasto?')) return;
  try { await Api.borrarMovimiento(id); cargarGastos(); } catch (err) { mostrarToast(err.message); }
}

document.getElementById('filtro-persona-gastos').addEventListener('change', cargarGastos);
document.getElementById('filtro-categoria-gastos').addEventListener('change', cargarGastos);

document.getElementById('btn-nuevo-gasto').addEventListener('click', () => {
  abrirModal(`
    <h3>Nuevo gasto</h3>
    <form id="form-gasto">
      <div class="form-grid">
        <div class="campo"><label>Fecha</label><input type="date" id="g-fecha" value="${fechaHoyLocal()}" required></div>
        <div class="campo"><label>Monto</label><input type="number" step="0.01" id="g-monto" required></div>
        <div class="campo"><label>Bolsillo</label><select id="g-cuenta">${opcionesCuenta()}</select></div>
        <div class="campo"><label>Categoría</label><select id="g-categoria">${opcionesCategoria()}</select></div>
        <div class="campo"><label>¿Quién pagó?</label><select id="g-persona">${opcionesPersona('ambos')}</select></div>
        <div class="campo"><label>Método (opcional)</label><input id="g-metodo" placeholder="Pago móvil, tarjeta..."></div>
      </div>
      ${bloqueTasaTipo('g')}
      ${bloqueCambioOpcional('g')}
      <div class="campo"><label>Descripción</label><input id="g-nota" required placeholder="¿En qué fue?"></div>
      ${bloqueAdjunto('g')}
      <div style="display:flex; gap:8px; margin-top:14px;">
        <button type="submit" class="btn btn-primario">Guardar</button>
        <button type="button" class="btn btn-fantasma" onclick="cerrarModal()">Cancelar</button>
      </div>
    </form>
  `);
  activarToggleTasaCuenta('g');
  activarPreviewFoto('g');
  manejarEnvio(document.getElementById('form-gasto'), async () => {
    const creado = await Api.crearMovimiento({
      tipo: 'gasto',
      fecha: document.getElementById('g-fecha').value,
      monto_original: document.getElementById('g-monto').value,
      cuenta_id: Number(document.getElementById('g-cuenta').value),
      ...leerTasaFormulario('g'),
      categoria: document.getElementById('g-categoria').value,
      persona: document.getElementById('g-persona').value,
      metodo: document.getElementById('g-metodo').value,
      nota: document.getElementById('g-nota').value
    });
    await subirAdjuntoSiHay('g', 'movimiento', creado.id);
    cerrarModal();
    mostrarToast('Gasto guardado');
    cargarGastos();
  });
});

// ========================================================================
// INGRESOS
// ========================================================================
async function cargarIngresos() {
  llenarSelectorMeses(document.getElementById('filtro-mes-ingresos'), MES_INGRESOS, (v) => { MES_INGRESOS = v; cargarIngresos(); });

  const fijo = CONFIG.ingreso_fijo;
  const mensualFeli = fijo.feli.monto_por_pago * FREQ_MULT[fijo.feli.frecuencia];
  const mensualVale = fijo.vale.monto_por_pago * FREQ_MULT[fijo.vale.frecuencia];
  document.getElementById('tarjetas-ingreso-fijo').innerHTML = `
    <div class="tarjeta">
      <div class="stat-label">${escapeHtml(nombreDe('feli'))} recibe</div>
      <div class="stat-valor">${fmtUsd(fijo.feli.monto_por_pago)}</div>
      <div class="stat-sub">cada ${FREQ_LABEL[fijo.feli.frecuencia]} · ≈ ${fmtUsd(mensualFeli)}/mes</div>
    </div>
    <div class="tarjeta">
      <div class="stat-label">${escapeHtml(nombreDe('vale'))} recibe</div>
      <div class="stat-valor">${fmtUsd(fijo.vale.monto_por_pago)}</div>
      <div class="stat-sub">cada ${FREQ_LABEL[fijo.vale.frecuencia]} · ≈ ${fmtUsd(mensualVale)}/mes</div>
    </div>
    <div class="tarjeta">
      <div class="stat-label">Ingreso combinado estimado</div>
      <div class="stat-valor verde">${fmtUsd(mensualFeli + mensualVale)}</div>
      <div class="stat-sub">por mes, entre los dos</div>
    </div>
  `;
  animarEntrada('tarjetas-ingreso-fijo');

  const ingresos = await Api.movimientos({ mes: MES_INGRESOS, tipo: 'ingreso' });
  const cont = document.getElementById('lista-ingresos');
  if (!ingresos.length) { cont.innerHTML = estadoVacio('cash', 'No hay ingresos registrados este mes todavía'); return; }
  cont.innerHTML = ingresos.map((i) => {
    const cuenta = cuentaPorId(i.cuenta_id);
    return `
    <div class="fila">
      <div class="info">
        <span class="principal">${escapeHtml(nombreDe(i.persona))}${i.nota ? ' · ' + escapeHtml(i.nota) : ''}</span>
        <span class="secundario">${fmtFecha(i.fecha)} · ${i.monto_original} ${i.moneda}${cuenta ? ' · ' + escapeHtml(cuenta.nombre) : ''}${detalleTasa(i)}</span>
        ${renderMiniaturas(i.adjuntos)}
      </div>
      <div class="monto ingreso">+${fmtUsd(i.monto_usd)}</div>
      <div class="acciones"><button class="btn btn-chico btn-icono btn-peligro" onclick="borrarIngreso(${i.id})">${icon('trash')}</button></div>
    </div>
  `;
  }).join('');
  animarEntrada('lista-ingresos');
}

async function borrarIngreso(id) {
  if (!confirm('¿Borrar este ingreso?')) return;
  try { await Api.borrarMovimiento(id); cargarIngresos(); } catch (err) { mostrarToast(err.message); }
}

document.getElementById('btn-nuevo-ingreso').addEventListener('click', () => {
  abrirModal(`
    <h3>Nuevo ingreso</h3>
    <form id="form-ingreso">
      <div class="form-grid">
        <div class="campo"><label>Fecha</label><input type="date" id="i-fecha" value="${fechaHoyLocal()}" required></div>
        <div class="campo"><label>Monto</label><input type="number" step="0.01" id="i-monto" required></div>
        <div class="campo"><label>Bolsillo</label><select id="i-cuenta">${opcionesCuenta()}</select></div>
        <div class="campo"><label>¿Quién recibió?</label><select id="i-persona">${opcionesPersona('feli')}</select></div>
      </div>
      ${bloqueTasaTipo('i')}
      ${bloqueCambioOpcional('i')}
      <div class="campo"><label>Nota (opcional)</label><input id="i-nota" placeholder="Quincena, extra, regalo..."></div>
      ${bloqueAdjunto('i')}
      <div style="display:flex; gap:8px; margin-top:14px;">
        <button type="submit" class="btn btn-primario">Guardar</button>
        <button type="button" class="btn btn-fantasma" onclick="cerrarModal()">Cancelar</button>
      </div>
    </form>
  `);
  activarToggleTasaCuenta('i');
  activarPreviewFoto('i');
  manejarEnvio(document.getElementById('form-ingreso'), async () => {
    const creado = await Api.crearMovimiento({
      tipo: 'ingreso',
      fecha: document.getElementById('i-fecha').value,
      monto_original: document.getElementById('i-monto').value,
      cuenta_id: Number(document.getElementById('i-cuenta').value),
      ...leerTasaFormulario('i'),
      persona: document.getElementById('i-persona').value,
      nota: document.getElementById('i-nota').value
    });
    await subirAdjuntoSiHay('i', 'movimiento', creado.id);
    cerrarModal();
    mostrarToast('Ingreso guardado');
    cargarIngresos();
  });
});

// ========================================================================
// BOLSILLOS
// ========================================================================
async function cargarBolsillos() {
  await cargarCuentasCache();
  const cont = document.getElementById('tarjetas-cuentas');
  if (!CUENTAS.length) {
    cont.innerHTML = estadoVacio('wallet', 'No hay bolsillos todavía');
  } else {
    cont.innerHTML = CUENTAS.map((c) => `
      <div class="tarjeta tarjeta-cuenta ${c.activa ? '' : 'inactiva'}">
        <div class="acciones-cuenta">
          <button class="btn btn-chico btn-icono btn-fantasma" onclick="editarCuenta(${c.id})" aria-label="Editar">${icon('settings')}</button>
          <button class="btn btn-chico btn-icono btn-peligro" onclick="borrarCuentaConfirm(${c.id})" aria-label="Borrar">${icon('trash')}</button>
        </div>
        <div class="tasa-encabezado"><span class="tasa-icono">${icon(iconoDeCuenta(c.tipo))}</span><span class="etiqueta">${escapeHtml(c.nombre)}</span></div>
        <div class="valor-cifra">${fmtMoneda(c.saldo, c.moneda)}</div>
        <div class="detalle">${c.moneda}${c.activa ? '' : ' · desactivado'}</div>
      </div>
    `).join('');
    animarEntrada('tarjetas-cuentas');
  }

  const cambios = await Api.cambios();
  const listaCont = document.getElementById('lista-cambios');
  if (!cambios.length) {
    listaCont.innerHTML = estadoVacio('swap', 'Todavía no han registrado cambios de divisa');
  } else {
    listaCont.innerHTML = cambios.map((c) => {
      const origen = cuentaPorId(c.cuenta_origen_id), destino = cuentaPorId(c.cuenta_destino_id);
      return `
      <div class="fila">
        <div class="info">
          <span class="principal">${escapeHtml(origen?.nombre || '—')} → ${escapeHtml(destino?.nombre || '—')}</span>
          <span class="secundario">${fmtFecha(c.fecha)} · tasa ${Number(c.tasa_usada).toFixed(2)}${c.nota ? ' · ' + escapeHtml(c.nota) : ''}</span>
        </div>
        <div class="monto">${c.monto_origen} ${origen?.moneda} → ${Number(c.monto_destino).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${destino?.moneda}</div>
        <div class="acciones"><button class="btn btn-chico btn-icono btn-peligro" onclick="borrarCambioConfirm(${c.id})">${icon('trash')}</button></div>
      </div>`;
    }).join('');
    animarEntrada('lista-cambios');
  }
}

async function borrarCuentaConfirm(id) {
  if (!confirm('¿Borrar este bolsillo?')) return;
  try { await Api.borrarCuenta(id); mostrarToast('Bolsillo borrado'); cargarBolsillos(); }
  catch (err) { mostrarToast(err.message); }
}
async function borrarCambioConfirm(id) {
  if (!confirm('¿Borrar este cambio de divisa?')) return;
  try { await Api.borrarCambio(id); mostrarToast('Cambio borrado'); cargarBolsillos(); }
  catch (err) { mostrarToast(err.message); }
}

function editarCuenta(id) {
  const c = cuentaPorId(id);
  abrirModal(`
    <h3>Editar bolsillo</h3>
    <form id="form-editar-cuenta">
      <div class="campo"><label>Nombre</label><input id="ec-nombre" value="${escapeHtml(c.nombre)}" required></div>
      <div class="campo"><label>Saldo inicial (${c.moneda})</label><input type="number" step="0.01" id="ec-saldo" value="${c.saldo_inicial}"></div>
      <div class="campo"><label style="display:flex;align-items:center;gap:6px;"><input type="checkbox" id="ec-activa" ${c.activa ? 'checked' : ''} style="width:auto;"> Bolsillo activo</label></div>
      <div style="display:flex; gap:8px; margin-top:14px;">
        <button type="submit" class="btn btn-primario">Guardar</button>
        <button type="button" class="btn btn-fantasma" onclick="cerrarModal()">Cancelar</button>
      </div>
    </form>
  `);
  manejarEnvio(document.getElementById('form-editar-cuenta'), async () => {
    await Api.actualizarCuenta(id, {
      nombre: document.getElementById('ec-nombre').value,
      saldo_inicial: document.getElementById('ec-saldo').value,
      activa: document.getElementById('ec-activa').checked
    });
    cerrarModal();
    mostrarToast('Bolsillo actualizado');
    cargarBolsillos();
  });
}

document.getElementById('btn-nuevo-bolsillo').addEventListener('click', () => {
  abrirModal(`
    <h3>Nuevo bolsillo</h3>
    <form id="form-nuevo-bolsillo">
      <div class="form-grid">
        <div class="campo"><label>Nombre</label><input id="nb-nombre" placeholder="Ej: Ahorros banco" required></div>
        <div class="campo"><label>Moneda</label><select id="nb-moneda">${opcionesMoneda('USD')}</select></div>
        <div class="campo"><label>Saldo inicial</label><input type="number" step="0.01" id="nb-saldo" value="0"></div>
      </div>
      <div style="display:flex; gap:8px; margin-top:14px;">
        <button type="submit" class="btn btn-primario">Crear</button>
        <button type="button" class="btn btn-fantasma" onclick="cerrarModal()">Cancelar</button>
      </div>
    </form>
  `);
  manejarEnvio(document.getElementById('form-nuevo-bolsillo'), async () => {
    await Api.crearCuenta({
      nombre: document.getElementById('nb-nombre').value,
      moneda: document.getElementById('nb-moneda').value,
      tipo: 'otro',
      saldo_inicial: document.getElementById('nb-saldo').value
    });
    cerrarModal();
    mostrarToast('Bolsillo creado');
    cargarBolsillos();
  });
});

document.getElementById('btn-nuevo-cambio').addEventListener('click', () => {
  abrirModal(`
    <h3>Cambiar divisa</h3>
    <form id="form-cambio">
      <div class="form-grid">
        <div class="campo"><label>Fecha</label><input type="date" id="c-fecha" value="${fechaHoyLocal()}" required></div>
        <div class="campo"><label>De (bolsillo origen)</label><select id="c-origen">${opcionesCuenta()}</select></div>
        <div class="campo"><label>Monto que cambian</label><input type="number" step="0.01" id="c-monto" required></div>
        <div class="campo"><label>A (bolsillo destino)</label><select id="c-destino">${opcionesCuenta()}</select></div>
      </div>
      <div class="campo" id="c-bloque-tasa">
        <label>Tasa a la que cambiaron (Bs. por USD)</label>
        <input type="number" step="0.01" id="c-tasa" placeholder="${TASAS?.tasa_efectivo ? TASAS.tasa_efectivo.toFixed(2) : ''}">
      </div>
      <div class="stat-sub" id="c-preview" style="margin-bottom:10px;"></div>
      <div class="campo"><label>Nota (opcional)</label><input id="c-nota"></div>
      <div style="display:flex; gap:8px; margin-top:14px;">
        <button type="submit" class="btn btn-primario">Guardar</button>
        <button type="button" class="btn btn-fantasma" onclick="cerrarModal()">Cancelar</button>
      </div>
    </form>
  `);
  const origenSel = document.getElementById('c-origen');
  const destinoSel = document.getElementById('c-destino');
  const otraCuenta = CUENTAS.find((c) => c.id !== Number(origenSel.value) && c.activa);
  if (otraCuenta) destinoSel.value = otraCuenta.id;

  const actualizarPreview = () => {
    const origen = cuentaPorId(origenSel.value), destino = cuentaPorId(destinoSel.value);
    const monto = Number(document.getElementById('c-monto').value) || 0;
    const tasaInput = Number(document.getElementById('c-tasa').value) || (TASAS ? TASAS.tasa_efectivo : 0);
    const previa = document.getElementById('c-preview');
    if (!origen || !destino || !monto) { previa.textContent = ''; return; }
    let destinoMonto;
    if (origen.moneda === destino.moneda) destinoMonto = monto;
    else if (origen.moneda === 'VES') destinoMonto = monto / tasaInput;
    else if (destino.moneda === 'VES') destinoMonto = monto * tasaInput;
    else destinoMonto = monto;
    previa.textContent = `≈ ${destinoMonto.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${destino.moneda} en ${destino.nombre}`;
  };
  const actualizarBloqueTasa = () => {
    const origen = cuentaPorId(origenSel.value), destino = cuentaPorId(destinoSel.value);
    const necesitaTasa = origen && destino && (origen.moneda === 'VES' || destino.moneda === 'VES');
    document.getElementById('c-bloque-tasa').style.display = necesitaTasa ? 'block' : 'none';
    actualizarPreview();
  };
  origenSel.addEventListener('change', actualizarBloqueTasa);
  destinoSel.addEventListener('change', actualizarBloqueTasa);
  document.getElementById('c-monto').addEventListener('input', actualizarPreview);
  document.getElementById('c-tasa').addEventListener('input', actualizarPreview);
  actualizarBloqueTasa();

  manejarEnvio(document.getElementById('form-cambio'), async () => {
    const origenId = Number(origenSel.value), destinoId = Number(destinoSel.value);
    if (origenId === destinoId) throw new Error('Elige dos bolsillos distintos');
    await Api.crearCambio({
      fecha: document.getElementById('c-fecha').value,
      cuenta_origen_id: origenId,
      monto_origen: document.getElementById('c-monto').value,
      cuenta_destino_id: destinoId,
      tasa_usada: document.getElementById('c-tasa').value || undefined,
      nota: document.getElementById('c-nota').value
    });
    cerrarModal();
    mostrarToast('Cambio registrado');
    cargarBolsillos();
  });
});

// ========================================================================
// DEUDAS
// ========================================================================
async function cargarDeudas() {
  const deudas = await Api.deudas();
  const activas = deudas.filter((d) => d.activa);
  const totalPendiente = activas.reduce((a, d) => a + d.restante_usd, 0);
  const totalOriginal = activas.reduce((a, d) => a + d.monto_total_usd, 0);
  const totalPagado = activas.reduce((a, d) => a + d.pagado_usd, 0);

  document.getElementById('tarjetas-deuda-resumen').innerHTML = `
    <div class="tarjeta"><div class="stat-label">Deuda total activa</div><div class="stat-valor rojo">${fmtUsd(totalOriginal)}</div></div>
    <div class="tarjeta"><div class="stat-label">Ya pagado</div><div class="stat-valor verde">${fmtUsd(totalPagado)}</div></div>
    <div class="tarjeta"><div class="stat-label">Falta por pagar</div><div class="stat-valor">${fmtUsd(totalPendiente)}</div></div>
  `;
  animarEntrada('tarjetas-deuda-resumen');

  const cont = document.getElementById('lista-deudas');
  if (!deudas.length) { cont.innerHTML = `<div class="tarjeta grande">${estadoVacio('list', 'No tienen deudas registradas')}</div>`; return; }
  cont.innerHTML = deudas.map((d) => {
    const pct = d.monto_total_usd > 0 ? Math.min(100, (d.pagado_usd / d.monto_total_usd) * 100) : 0;
    return `
    <div class="tarjeta grande">
      <div class="fila" style="background:none; padding:0;">
        <div class="info">
          <span class="principal">${escapeHtml(d.nombre)} <span class="pill ${d.activa ? '' : 'verde'}">${escapeHtml(nombreDe(d.persona))}</span>${d.origen === 'cashea' ? ' <span class="pill morado">Cashea</span>' : ''}</span>
          <span class="secundario">${fmtUsd(d.monto_total_usd)} total · desde ${fmtFecha(d.fecha_inicio)}${d.fecha_limite ? ' · límite ' + fmtFecha(d.fecha_limite) : ''}${d.nota ? ' · ' + escapeHtml(d.nota) : ''}</span>
          ${d.origen === 'cashea' && d.activa ? `<span class="secundario">Cuota ${Math.min(d.cuotas_pagadas + 1, d.cuotas_totales)} de ${d.cuotas_totales} · ${fmtUsd(d.monto_cuota_usd)} c/u${d.proxima_cuota_fecha ? ' · próxima: ' + fmtFecha(d.proxima_cuota_fecha) : ''}</span>` : ''}
        </div>
        <div class="acciones">
          ${d.activa ? `<button class="btn btn-chico btn-secundario" onclick="abrirPago(${d.id})">+ Pago</button>` : `<span class="pill verde">Pagada</span>`}
          <button class="btn btn-chico btn-icono btn-peligro" onclick="eliminarDeuda(${d.id})">${icon('trash')}</button>
        </div>
      </div>
      <div class="barra-progreso"><div class="lleno" style="width:${pct}%"></div></div>
      <div class="stat-sub" style="margin-top:8px;">${fmtUsd(d.pagado_usd)} pagado · ${fmtUsd(d.restante_usd)} restante (${pct.toFixed(0)}%)</div>
      ${d.pagos.length ? `<div class="lista" style="margin-top:12px;">${d.pagos.map((p) => `
        <div class="fila" style="padding:8px 12px;">
          <div class="info">
            <span class="secundario">${fmtFecha(p.fecha)} · ${p.monto_original} ${p.moneda}${detalleTasa(p)}${p.nota ? ' · ' + escapeHtml(p.nota) : ''}</span>
            ${renderMiniaturas(p.adjuntos)}
          </div>
          <div class="monto ingreso" style="font-size:0.9rem;">${fmtUsd(p.monto_usd)}</div>
          <button class="btn btn-chico btn-icono btn-fantasma" onclick="eliminarPago(${d.id}, ${p.id})">${icon('x')}</button>
        </div>`).join('')}</div>` : ''}
    </div>`;
  }).join('');
  animarEntrada('lista-deudas');
}

async function eliminarDeuda(id) {
  if (!confirm('¿Borrar esta deuda y todos sus pagos?')) return;
  try { await Api.borrarDeuda(id); cargarDeudas(); } catch (err) { mostrarToast(err.message); }
}
async function eliminarPago(deudaId, pagoId) {
  if (!confirm('¿Borrar este pago?')) return;
  try { await Api.borrarPago(deudaId, pagoId); cargarDeudas(); } catch (err) { mostrarToast(err.message); }
}

document.getElementById('btn-nueva-deuda').addEventListener('click', () => {
  abrirModal(`
    <h3>Nueva deuda</h3>
    <form id="form-deuda">
      <div class="campo"><label>Nombre de la deuda</label><input id="d-nombre" placeholder="Tarjeta, préstamo, cuota..." required></div>
      <div class="form-grid">
        <div class="campo"><label>Monto total</label><input type="number" step="0.01" id="d-monto" required></div>
        <div class="campo"><label>Moneda</label><select id="d-moneda">${opcionesMoneda('USD', false)}</select></div>
        <div class="campo"><label>¿De quién?</label><select id="d-persona">${opcionesPersona('ambos')}</select></div>
        <div class="campo"><label>Fecha inicio</label><input type="date" id="d-fecha-inicio" value="${fechaHoyLocal()}" required></div>
        <div class="campo"><label>Fecha límite (opcional)</label><input type="date" id="d-fecha-limite"></div>
      </div>
      ${bloqueTasaTipo('d')}
      <div class="campo"><label>Nota (opcional)</label><input id="d-nota"></div>
      <div style="display:flex; gap:8px; margin-top:14px;">
        <button type="submit" class="btn btn-primario">Guardar</button>
        <button type="button" class="btn btn-fantasma" onclick="cerrarModal()">Cancelar</button>
      </div>
    </form>
  `);
  activarToggleTasa('d');
  manejarEnvio(document.getElementById('form-deuda'), async () => {
    await Api.crearDeuda({
      nombre: document.getElementById('d-nombre').value,
      monto_total: document.getElementById('d-monto').value,
      moneda: document.getElementById('d-moneda').value,
      ...leerTasaFormulario('d'),
      persona: document.getElementById('d-persona').value,
      fecha_inicio: document.getElementById('d-fecha-inicio').value,
      fecha_limite: document.getElementById('d-fecha-limite').value || null,
      nota: document.getElementById('d-nota').value
    });
    cerrarModal();
    mostrarToast('Deuda creada');
    cargarDeudas();
  });
});

document.getElementById('btn-nueva-cashea').addEventListener('click', () => {
  abrirModal(`
    <h3>Compra en Cashea</h3>
    <form id="form-cashea">
      <div class="campo"><label>Producto</label><input id="dc-nombre" placeholder="¿Qué compraron?" required></div>
      <div class="form-grid">
        <div class="campo"><label>Precio total</label><input type="number" step="0.01" id="dc-monto" required></div>
        <div class="campo"><label>Moneda</label><select id="dc-moneda">${opcionesMoneda('USD', false)}</select></div>
        <div class="campo"><label>Inicial pagado</label><input type="number" step="0.01" id="dc-inicial" required></div>
        <div class="campo"><label>¿De qué bolsillo salió el inicial?</label><select id="dc-cuenta">${opcionesCuenta()}</select></div>
        <div class="campo"><label>Cuotas</label>
          <select id="dc-cuotas">
            <option value="3">3 cuotas</option>
            <option value="6">6 cuotas</option>
            <option value="9">9 cuotas</option>
            <option value="12">12 cuotas</option>
          </select>
        </div>
        <div class="campo"><label>¿De quién?</label><select id="dc-persona">${opcionesPersona('ambos')}</select></div>
        <div class="campo"><label>Fecha de compra</label><input type="date" id="dc-fecha" value="${fechaHoyLocal()}" required></div>
      </div>
      ${bloqueTasaTipo('dc')}
      <p class="texto-explicativo" style="font-size:0.8rem;">Las cuotas de Cashea son cada 14 días, sin interés — la app arma solo el calendario.</p>
      <div style="display:flex; gap:8px; margin-top:14px;">
        <button type="submit" class="btn btn-primario">Guardar</button>
        <button type="button" class="btn btn-fantasma" onclick="cerrarModal()">Cancelar</button>
      </div>
    </form>
  `);
  activarToggleTasa('dc');
  manejarEnvio(document.getElementById('form-cashea'), async () => {
    await Api.crearDeuda({
      nombre: document.getElementById('dc-nombre').value,
      monto_total: document.getElementById('dc-monto').value,
      moneda: document.getElementById('dc-moneda').value,
      ...leerTasaFormulario('dc'),
      persona: document.getElementById('dc-persona').value,
      fecha_inicio: document.getElementById('dc-fecha').value,
      origen: 'cashea',
      cuotas_totales: Number(document.getElementById('dc-cuotas').value),
      frecuencia_dias: 14,
      inicial: document.getElementById('dc-inicial').value,
      cuenta_id: Number(document.getElementById('dc-cuenta').value)
    });
    cerrarModal();
    mostrarToast('Compra de Cashea guardada');
    cargarDeudas();
  });
});

function abrirPago(deudaId) {
  abrirModal(`
    <h3>Registrar pago</h3>
    <form id="form-pago">
      <div class="form-grid">
        <div class="campo"><label>Fecha</label><input type="date" id="p-fecha" value="${fechaHoyLocal()}" required></div>
        <div class="campo"><label>Monto</label><input type="number" step="0.01" id="p-monto" required></div>
        <div class="campo"><label>Bolsillo</label><select id="p-cuenta">${opcionesCuenta()}</select></div>
      </div>
      ${bloqueTasaTipo('p')}
      ${bloqueCambioOpcional('p')}
      <div class="campo"><label>Nota (opcional)</label><input id="p-nota"></div>
      ${bloqueAdjunto('p')}
      <div style="display:flex; gap:8px; margin-top:14px;">
        <button type="submit" class="btn btn-primario">Guardar</button>
        <button type="button" class="btn btn-fantasma" onclick="cerrarModal()">Cancelar</button>
      </div>
    </form>
  `);
  activarToggleTasaCuenta('p');
  activarPreviewFoto('p');
  manejarEnvio(document.getElementById('form-pago'), async () => {
    const cuenta = cuentaPorId(document.getElementById('p-cuenta').value);
    const creado = await Api.registrarPago(deudaId, {
      fecha: document.getElementById('p-fecha').value,
      monto_original: document.getElementById('p-monto').value,
      moneda: cuenta.moneda,
      ...leerTasaFormulario('p'),
      cuenta_id: cuenta.id,
      nota: document.getElementById('p-nota').value
    });
    await subirAdjuntoSiHay('p', 'pago_deuda', creado.id);
    cerrarModal();
    mostrarToast('Pago registrado');
    cargarDeudas();
  });
}

// ========================================================================
// INVERSIÓN
// ========================================================================
function etiquetaTipoInv(tipo) { return { aporte: 'Aporte', retorno: 'Venta / retorno', costo: 'Costo' }[tipo] || tipo; }

async function cargarInversion() {
  const inversiones = await Api.inversiones();
  const cont = document.getElementById('lista-inversiones');
  if (!inversiones.length) { cont.innerHTML = estadoVacio('target', 'Todavía no registraron ninguna inversión'); return; }
  cont.innerHTML = inversiones.map(renderTarjetaInversion).join('');
  animarEntrada('lista-inversiones');
}

function renderTarjetaInversion(inv) {
  const esNegocio = inv.tipo === 'negocio';
  // pct es para el TEXTO (puede ser negativo, ej. -35%, si van perdiendo) — no ocultar eso.
  // pctBarra es solo para el ancho de la barra visual, que no puede ser negativo.
  const pct = inv.progreso != null ? inv.progreso * 100 : null;
  const pctBarra = pct != null ? Math.max(0, Math.min(100, pct)) : 0;
  return `
    <div class="tarjeta grande tarjeta-inversion">
      <div class="inversion-cabecera">
        <div>
          <span class="pill ${esNegocio ? 'morado' : 'verde'}">${esNegocio ? 'Negocio' : 'Fondo'}</span>
          <h3 style="margin-top:6px;">${escapeHtml(inv.nombre)}</h3>
        </div>
        <div class="acciones">
          <button class="btn btn-chico btn-secundario" onclick="abrirMovimientoInversion(${inv.id})">+ Movimiento</button>
          <button class="btn btn-chico btn-icono btn-peligro" onclick="borrarInversionConfirm(${inv.id})">${icon('trash')}</button>
        </div>
      </div>
      <div class="inversion-metricas">
        ${esNegocio ? `
          <div><div class="stat-label">Capital</div><div class="stat-valor">${fmtUsd(inv.aportes)}</div></div>
          <div><div class="stat-label">Costos</div><div class="stat-valor rojo">${fmtUsd(inv.costos)}</div></div>
          <div><div class="stat-label">Ventas</div><div class="stat-valor verde">${fmtUsd(inv.retornos)}</div></div>
          <div><div class="stat-label">Ganancia neta</div><div class="stat-valor ${inv.ganancia_neta >= 0 ? 'verde' : 'rojo'}">${fmtUsd(inv.ganancia_neta)}</div></div>
        ` : `
          <div><div class="stat-label">Aportado</div><div class="stat-valor">${fmtUsd(inv.aportes)}</div></div>
          <div><div class="stat-label">Retirado</div><div class="stat-valor">${fmtUsd(inv.retornos)}</div></div>
          <div><div class="stat-label">Acumulado</div><div class="stat-valor verde">${fmtUsd(inv.acumulado)}</div></div>
        `}
      </div>
      ${inv.meta_monto_usd ? `
        <div>
          <div class="stat-sub">Meta: ${fmtUsd(inv.meta_monto_usd)}${pct !== null ? ' · ' + pct.toFixed(0) + '%' : ''}</div>
          <div class="barra-progreso"><div class="lleno" style="width:${pctBarra}%"></div></div>
        </div>` : ''}
      ${inv.movimientos.length ? `
        <div class="lista lista-movimientos-inv">
          ${inv.movimientos.slice(0, 6).map((m) => `
            <div class="fila" style="padding:8px 12px;">
              <div class="info">
                <span class="secundario">${fmtFecha(m.fecha)} · ${etiquetaTipoInv(m.tipo)}${detalleTasa(m)}${m.nota ? ' · ' + escapeHtml(m.nota) : ''}</span>
                ${renderMiniaturas(m.adjuntos)}
              </div>
              <div class="monto ${m.tipo === 'retorno' ? 'ingreso' : 'gasto'}" style="font-size:0.9rem;">${fmtUsd(m.monto_usd)}</div>
              <button class="btn btn-chico btn-icono btn-fantasma" onclick="borrarMovInversionConfirm(${inv.id}, ${m.id})">${icon('x')}</button>
            </div>`).join('')}
        </div>` : ''}
    </div>`;
}

async function borrarInversionConfirm(id) {
  if (!confirm('¿Borrar esta inversión y todos sus movimientos?')) return;
  try { await Api.borrarInversion(id); mostrarToast('Inversión borrada'); cargarInversion(); } catch (err) { mostrarToast(err.message); }
}
async function borrarMovInversionConfirm(invId, movId) {
  if (!confirm('¿Borrar este movimiento?')) return;
  try { await Api.borrarMovimientoInversion(invId, movId); mostrarToast('Movimiento borrado'); cargarInversion(); } catch (err) { mostrarToast(err.message); }
}

document.getElementById('btn-nueva-inversion').addEventListener('click', () => {
  abrirModal(`
    <h3>Nueva inversión</h3>
    <form id="form-nueva-inversion">
      <div class="campo"><label>Nombre</label><input id="ni-nombre" placeholder="Ej: Tienda de trajes de baño" required></div>
      <div class="form-grid">
        <div class="campo"><label>Tipo</label>
          <select id="ni-tipo"><option value="negocio">Negocio</option><option value="fondo">Fondo con meta</option></select>
        </div>
        <div class="campo"><label id="ni-meta-label">Meta de ganancia (USD, opcional)</label><input type="number" step="0.01" id="ni-meta"></div>
      </div>
      <div style="display:flex; gap:8px; margin-top:14px;">
        <button type="submit" class="btn btn-primario">Crear</button>
        <button type="button" class="btn btn-fantasma" onclick="cerrarModal()">Cancelar</button>
      </div>
    </form>
  `);
  document.getElementById('ni-tipo').addEventListener('change', (e) => {
    document.getElementById('ni-meta-label').textContent = e.target.value === 'negocio' ? 'Meta de ganancia (USD, opcional)' : 'Meta de ahorro (USD, opcional)';
  });
  manejarEnvio(document.getElementById('form-nueva-inversion'), async () => {
    await Api.crearInversion({
      nombre: document.getElementById('ni-nombre').value,
      tipo: document.getElementById('ni-tipo').value,
      meta_monto_usd: document.getElementById('ni-meta').value || null
    });
    cerrarModal();
    mostrarToast('Inversión creada');
    cargarInversion();
  });
});

function abrirMovimientoInversion(invId) {
  abrirModal(`
    <h3>Nuevo movimiento</h3>
    <form id="form-mov-inversion">
      <div class="form-grid">
        <div class="campo"><label>Tipo</label>
          <select id="mi-tipo">
            <option value="aporte">Aporte (meten capital)</option>
            <option value="retorno">Venta / retorno</option>
            <option value="costo">Costo</option>
          </select>
        </div>
        <div class="campo"><label>Fecha</label><input type="date" id="mi-fecha" value="${fechaHoyLocal()}" required></div>
        <div class="campo"><label>Monto</label><input type="number" step="0.01" id="mi-monto" required></div>
        <div class="campo"><label>Bolsillo</label><select id="mi-cuenta">${opcionesCuenta()}</select></div>
      </div>
      ${bloqueTasaTipo('mi')}
      ${bloqueCambioOpcional('mi')}
      <div class="campo"><label>Nota (opcional)</label><input id="mi-nota"></div>
      ${bloqueAdjunto('mi')}
      <div style="display:flex; gap:8px; margin-top:14px;">
        <button type="submit" class="btn btn-primario">Guardar</button>
        <button type="button" class="btn btn-fantasma" onclick="cerrarModal()">Cancelar</button>
      </div>
    </form>
  `);
  activarToggleTasaCuenta('mi');
  activarPreviewFoto('mi');
  manejarEnvio(document.getElementById('form-mov-inversion'), async () => {
    const cuenta = cuentaPorId(document.getElementById('mi-cuenta').value);
    const creado = await Api.agregarMovimientoInversion(invId, {
      tipo: document.getElementById('mi-tipo').value,
      fecha: document.getElementById('mi-fecha').value,
      monto_original: document.getElementById('mi-monto').value,
      moneda: cuenta.moneda,
      ...leerTasaFormulario('mi'),
      cuenta_id: cuenta.id,
      nota: document.getElementById('mi-nota').value
    });
    await subirAdjuntoSiHay('mi', 'movimiento_inversion', creado.id);
    cerrarModal();
    mostrarToast('Movimiento guardado');
    cargarInversion();
  });
}

// ========================================================================
// AHORRO
// ========================================================================
async function cargarAhorro() {
  const metas = await Api.metas();
  const mesActualStr = formatoMes(new Date());
  const mesActualData = metas.meses[mesActualStr] || { ingresos: 0, gastos: 0, ahorrado: 0, meta_efectiva: 0, meta_base: 0, arrastre_entrante: 0, faltante: 0, cumplida: true };

  document.getElementById('tarjetas-ahorro').innerHTML = `
    <div class="tarjeta">
      <div class="stat-label">Meta efectiva este mes</div>
      <div class="stat-valor" id="ah-meta">$0.00</div>
      <div class="stat-sub">${metas.config.modo === 'monto' ? 'Monto fijo' : metas.config.pct + '% del ingreso'}${mesActualData.arrastre_entrante > 0 ? ` + ${fmtUsd(mesActualData.arrastre_entrante)} arrastrados` : ''}</div>
    </div>
    <div class="tarjeta">
      <div class="stat-label">Ahorrado este mes</div>
      <div class="stat-valor ${mesActualData.cumplida ? 'verde' : 'rojo'}" id="ah-real">$0.00</div>
    </div>
    <div class="tarjeta">
      <div class="stat-label">${mesActualData.cumplida ? 'Van sobrados' : 'Falta para la meta'}</div>
      <div class="stat-valor ${mesActualData.cumplida ? 'verde' : 'rojo'}" id="ah-dif">$0.00</div>
    </div>
  `;
  animarNumero(document.getElementById('ah-meta'), mesActualData.meta_efectiva, { prefijo: '$' });
  animarNumero(document.getElementById('ah-real'), mesActualData.ahorrado, { prefijo: '$' });
  animarNumero(document.getElementById('ah-dif'), Math.abs(mesActualData.ahorrado - mesActualData.meta_efectiva), { prefijo: '$' });
  animarEntrada('tarjetas-ahorro');

  const contQ = document.getElementById('lista-quincenas');
  const quincenasRecientes = [...metas.quincenas].slice(-6).reverse();
  if (!quincenasRecientes.length) {
    contQ.innerHTML = estadoVacio('trend', 'Registren ingresos y gastos para ver sus metas');
  } else {
    contQ.innerHTML = quincenasRecientes.map((q) => `
      <div class="fila fila-quincena">
        <div class="quincena-cabecera">
          <span class="principal">${etiquetaMesLargo(q.mes)} · Quincena ${q.quincena}</span>
          <span class="pill ${q.cumplida ? 'verde' : 'rojo'}">${q.cumplida ? 'Cumplida' : 'Faltó ' + fmtUsd(q.faltante)}</span>
        </div>
        <div class="quincena-detalle">
          <span>Ingresos: <b>${fmtUsd(q.ingresos)}</b></span>
          <span>Gastos: <b>${fmtUsd(q.gastos)}</b></span>
          <span>Ahorrado: <b>${fmtUsd(q.ahorrado)}</b></span>
          <span>Meta: <b>${fmtUsd(q.meta_efectiva)}</b>${q.arrastre_entrante > 0 ? ` (${fmtUsd(q.meta_base)} + ${fmtUsd(q.arrastre_entrante)} arrastrados)` : ''}</span>
        </div>
      </div>
    `).join('');
    animarEntrada('lista-quincenas');
  }

  const r = await Api.resumen(mesActualStr);
  const ahorroMensualProyectado = r.dia_actual
    ? (r.ingreso_total - (r.proyeccion_gasto_fin_mes ?? r.gasto_total) - r.pago_deuda_total)
    : r.ahorro_real;
  Charts.proyeccionAhorro('chart-proyeccion-ahorro', ahorroMensualProyectado, mesActualData.meta_efectiva || r.ahorro_sugerido);
  Charts.prediccionCategorias('chart-prediccion', r.gasto_por_categoria, r.proyeccion_por_categoria || {});

  const historialTasas = await Api.historialTasas(30);
  Charts.historialTasas('chart-tasas-historial', historialTasas);
}

// ========================================================================
// AJUSTES
// ========================================================================
async function cargarAjustes() {
  CONFIG = await Api.config();
  document.getElementById('ajuste-nombre-feli').value = CONFIG.nombres.feli;
  document.getElementById('ajuste-nombre-vale').value = CONFIG.nombres.vale;
  document.getElementById('ajuste-feli-monto').value = CONFIG.ingreso_fijo.feli.monto_por_pago;
  document.getElementById('ajuste-feli-frecuencia').value = CONFIG.ingreso_fijo.feli.frecuencia;
  document.getElementById('ajuste-vale-monto').value = CONFIG.ingreso_fijo.vale.monto_por_pago;
  document.getElementById('ajuste-vale-frecuencia').value = CONFIG.ingreso_fijo.vale.frecuencia;

  const meta = CONFIG.meta_ahorro || { modo: 'pct', monto_mensual: 0, pct: 20 };
  document.getElementById('ajuste-meta-pct').value = meta.pct;
  document.getElementById('ajuste-meta-monto').value = meta.monto_mensual;
  seleccionarModoMeta(meta.modo);

  renderListaCategorias();
}

function seleccionarModoMeta(modo) {
  document.querySelectorAll('#selector-modo-meta .modo-btn').forEach((b) => b.classList.toggle('activo', b.dataset.modo === modo));
  document.getElementById('campo-meta-pct').style.display = modo === 'pct' ? 'block' : 'none';
  document.getElementById('campo-meta-monto').style.display = modo === 'monto' ? 'block' : 'none';
}
document.querySelectorAll('#selector-modo-meta .modo-btn').forEach((b) => b.addEventListener('click', () => seleccionarModoMeta(b.dataset.modo)));

function renderListaCategorias() {
  document.getElementById('lista-categorias').innerHTML = CONFIG.categorias_gasto.map((c) => `
    <span class="pill-categoria">${escapeHtml(c)}<button type="button" onclick="quitarCategoria(${JSON.stringify(c)})" aria-label="Quitar">${icon('x')}</button></span>
  `).join('');
}
function quitarCategoria(nombre) {
  CONFIG.categorias_gasto = CONFIG.categorias_gasto.filter((c) => c !== nombre);
  renderListaCategorias();
}
document.getElementById('btn-agregar-categoria').addEventListener('click', () => {
  const input = document.getElementById('nueva-categoria');
  const val = input.value.trim();
  if (!val) return;
  if (!CONFIG.categorias_gasto.includes(val)) CONFIG.categorias_gasto.push(val);
  input.value = '';
  renderListaCategorias();
});

document.getElementById('btn-guardar-ajustes').addEventListener('click', async () => {
  const modoActivo = document.querySelector('#selector-modo-meta .modo-btn.activo')?.dataset.modo || 'pct';
  try {
    await Api.guardarConfig({
      nombres: {
        feli: document.getElementById('ajuste-nombre-feli').value || 'Pareja 1',
        vale: document.getElementById('ajuste-nombre-vale').value || 'Pareja 2'
      },
      ingreso_fijo: {
        feli: { monto_por_pago: Number(document.getElementById('ajuste-feli-monto').value), moneda: 'USD', frecuencia: document.getElementById('ajuste-feli-frecuencia').value },
        vale: { monto_por_pago: Number(document.getElementById('ajuste-vale-monto').value), moneda: 'USD', frecuencia: document.getElementById('ajuste-vale-frecuencia').value }
      },
      meta_ahorro: {
        modo: modoActivo,
        pct: Number(document.getElementById('ajuste-meta-pct').value) || 0,
        monto_mensual: Number(document.getElementById('ajuste-meta-monto').value) || 0
      },
      categorias_gasto: CONFIG.categorias_gasto
    });
    document.getElementById('ajustes-guardado').classList.add('visible');
    mostrarToast('Ajustes guardados');
    // Nombres/categorías se usan en varias vistas ya renderizadas (saludo, filtros...);
    // recargar es lo más simple y confiable para que todo quede consistente.
    setTimeout(() => location.reload(), 700);
  } catch (err) {
    mostrarToast(err.message);
  }
});

// Los nombres de la pareja son editables en Ajustes: este método refresca todo texto fijo que los muestre.
function aplicarNombres() {
  document.querySelectorAll('.n-feli').forEach((n) => { n.textContent = nombreDe('feli'); });
  document.querySelectorAll('.n-vale').forEach((n) => { n.textContent = nombreDe('vale'); });
  document.getElementById('saludo').textContent = `Hola, ${nombreDe('feli')} y ${nombreDe('vale')}`;
}

// ---------- Arranque ----------
(async function iniciar() {
  CONFIG = await Api.config();
  await cargarCuentasCache();
  aplicarNombres();
  await cargarInicio();
  setInterval(() => renderTasas(), 5 * 60 * 1000);
})();
