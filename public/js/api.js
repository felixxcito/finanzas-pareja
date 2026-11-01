const Api = {
  async _fetch(url, opts) {
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Error de red');
    return data;
  },
  _json(url, method, body) {
    return Api._fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  },

  tasas: (forzar) => Api._fetch('/api/tasas' + (forzar ? '?forzar=1' : '')),
  historialTasas: (dias = 30) => Api._fetch(`/api/tasas/historial?dias=${dias}`),

  movimientos: (query = {}) => {
    const qs = new URLSearchParams(query).toString();
    return Api._fetch('/api/movimientos' + (qs ? '?' + qs : ''));
  },
  crearMovimiento: (body) => Api._json('/api/movimientos', 'POST', body),
  actualizarMovimiento: (id, body) => Api._json('/api/movimientos/' + id, 'PUT', body),
  borrarMovimiento: (id) => Api._fetch('/api/movimientos/' + id, { method: 'DELETE' }),

  deudas: () => Api._fetch('/api/deudas'),
  crearDeuda: (body) => Api._json('/api/deudas', 'POST', body),
  actualizarDeuda: (id, body) => Api._json('/api/deudas/' + id, 'PUT', body),
  borrarDeuda: (id) => Api._fetch('/api/deudas/' + id, { method: 'DELETE' }),
  registrarPago: (deudaId, body) => Api._json(`/api/deudas/${deudaId}/pagos`, 'POST', body),
  borrarPago: (deudaId, pagoId) => Api._fetch(`/api/deudas/${deudaId}/pagos/${pagoId}`, { method: 'DELETE' }),

  cuentas: (todas) => Api._fetch('/api/cuentas' + (todas ? '?todas=1' : '')),
  crearCuenta: (body) => Api._json('/api/cuentas', 'POST', body),
  actualizarCuenta: (id, body) => Api._json('/api/cuentas/' + id, 'PUT', body),
  borrarCuenta: (id) => Api._fetch('/api/cuentas/' + id, { method: 'DELETE' }),

  cambios: (query = {}) => {
    const qs = new URLSearchParams(query).toString();
    return Api._fetch('/api/cambios' + (qs ? '?' + qs : ''));
  },
  crearCambio: (body) => Api._json('/api/cambios', 'POST', body),
  borrarCambio: (id) => Api._fetch('/api/cambios/' + id, { method: 'DELETE' }),

  inversiones: () => Api._fetch('/api/inversiones'),
  inversion: (id) => Api._fetch('/api/inversiones/' + id),
  crearInversion: (body) => Api._json('/api/inversiones', 'POST', body),
  actualizarInversion: (id, body) => Api._json('/api/inversiones/' + id, 'PUT', body),
  borrarInversion: (id) => Api._fetch('/api/inversiones/' + id, { method: 'DELETE' }),
  agregarMovimientoInversion: (invId, body) => Api._json(`/api/inversiones/${invId}/movimientos`, 'POST', body),
  borrarMovimientoInversion: (invId, movId) => Api._fetch(`/api/inversiones/${invId}/movimientos/${movId}`, { method: 'DELETE' }),

  adjuntos: (entidad, entidadId) => Api._fetch(`/api/adjuntos?entidad=${entidad}&entidad_id=${entidadId}`),
  subirAdjunto: (body) => Api._json('/api/adjuntos', 'POST', body),
  borrarAdjunto: (id) => Api._fetch('/api/adjuntos/' + id, { method: 'DELETE' }),
  urlAdjunto: (id) => `/api/adjuntos/archivo/${id}`,

  metas: (hasta) => Api._fetch('/api/metas' + (hasta ? '?hasta=' + hasta : '')),

  config: () => Api._fetch('/api/config'),
  guardarConfig: (body) => Api._json('/api/config', 'PUT', body),

  resumen: (mes) => Api._fetch('/api/resumen?mes=' + mes),
  historialResumen: (meses = 6, hasta) => Api._fetch(`/api/resumen/historial?meses=${meses}` + (hasta ? `&hasta=${hasta}` : ''))
};
