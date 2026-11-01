const PALETA = {
  accent: '#C13E74',
  accentStrong: '#96285A',
  lavender: '#7B6BB0',
  success: '#29876B',
  danger: '#C6435F',
  warning: '#B9832B',
  faint: '#A794A0',
  categorias: ['#C13E74', '#7B6BB0', '#B9832B', '#29876B', '#4E8FC1', '#C6435F', '#96285A', '#5CC4A0', '#D98CB3', '#8B7BB0']
};

Chart.defaults.font.family = "'Plus Jakarta Sans', sans-serif";
Chart.defaults.color = '#6E5A66';

const Charts = {
  _instancias: {},

  destruir(id) {
    if (this._instancias[id]) {
      this._instancias[id].destroy();
      delete this._instancias[id];
    }
  },

  _vacio(canvasId, mensaje) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    ctx.parentElement.querySelector('.sin-datos')?.remove();
    const msg = document.createElement('div');
    msg.className = 'vacio sin-datos';
    msg.textContent = mensaje;
    ctx.style.display = 'none';
    ctx.after(msg);
  },
  _limpiarVacio(canvasId) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    ctx.parentElement.querySelector('.sin-datos')?.remove();
    ctx.style.display = 'block';
  },

  categorias(canvasId, dataObj) {
    this.destruir(canvasId);
    const entradas = Object.entries(dataObj).sort((a, b) => b[1] - a[1]);
    if (!entradas.length) { this._vacio(canvasId, 'Todavía no hay gastos este mes'); return; }
    this._limpiarVacio(canvasId);
    const total = entradas.reduce((a, e) => a + e[1], 0);
    const ctx = document.getElementById(canvasId);
    this._instancias[canvasId] = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: entradas.map((e) => e[0]),
        datasets: [{ data: entradas.map((e) => e[1]), backgroundColor: PALETA.categorias, borderWidth: 3, borderColor: '#fff', hoverOffset: 4 }]
      },
      options: {
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'circle', padding: 14, font: { size: 11.5, weight: 600 },
              generateLabels(chart) {
                const data = chart.data.datasets[0].data;
                return chart.data.labels.map((label, i) => ({
                  text: `${label} (${total > 0 ? (data[i] / total * 100).toFixed(0) : 0}%)`,
                  fillStyle: chart.data.datasets[0].backgroundColor[i],
                  strokeStyle: '#fff', lineWidth: 1, index: i
                }));
              }
            }
          },
          tooltip: {
            backgroundColor: '#241820', padding: 10, cornerRadius: 8,
            callbacks: { label: (c) => ` ${c.label}: $${c.parsed.toFixed(2)} (${total > 0 ? (c.parsed / total * 100).toFixed(1) : 0}%)` }
          }
        },
        cutout: '68%',
        responsive: true,
        maintainAspectRatio: false,
        animation: { animateRotate: true, duration: 700, easing: 'easeOutQuint' }
      }
    });
  },

  tendencia(canvasId, labels, ingresos, gastos) {
    this.destruir(canvasId);
    const ctx = document.getElementById(canvasId);
    this._instancias[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Ingresos', data: ingresos, backgroundColor: PALETA.success, borderRadius: 6, maxBarThickness: 26 },
          { label: 'Gastos', data: gastos, backgroundColor: PALETA.danger, borderRadius: 6, maxBarThickness: 26 }
        ]
      },
      options: {
        plugins: {
          legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', font: { size: 11.5, weight: 600 } } },
          tooltip: { backgroundColor: '#241820', padding: 10, cornerRadius: 8, callbacks: { label: (c) => ` ${c.dataset.label}: $${c.parsed.y.toFixed(2)}` } }
        },
        scales: {
          y: { beginAtZero: true, ticks: { callback: (v) => '$' + v, font: { size: 11 } }, grid: { color: 'rgba(60,35,50,0.06)' } },
          x: { grid: { display: false }, ticks: { font: { size: 11 } } }
        },
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 600, easing: 'easeOutQuint' }
      }
    });
  },

  sparkline(canvasId, valores, color) {
    this.destruir(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    this._instancias[canvasId] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: valores.map((_, i) => i),
        datasets: [{ data: valores, borderColor: color, borderWidth: 2, pointRadius: 0, tension: 0.4, fill: true, backgroundColor: color + '18' }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: { x: { display: false }, y: { display: false } },
        elements: { line: { borderJoinStyle: 'round' } },
        animation: { duration: 500 }
      }
    });
  },

  prediccionCategorias(canvasId, gastoPorCategoria, proyeccionPorCategoria) {
    this.destruir(canvasId);
    const categorias = Object.keys({ ...gastoPorCategoria, ...(proyeccionPorCategoria || {}) });
    if (!categorias.length) { this._vacio(canvasId, 'Registra gastos este mes para ver la proyección'); return; }
    this._limpiarVacio(canvasId);
    const ctx = document.getElementById(canvasId);
    const gastado = categorias.map((c) => gastoPorCategoria[c] || 0);
    const restante = categorias.map((c) => Math.max(0, (proyeccionPorCategoria?.[c] || 0) - (gastoPorCategoria[c] || 0)));
    this._instancias[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: categorias,
        datasets: [
          { label: 'Ya gastado', data: gastado, backgroundColor: PALETA.accent, borderRadius: 5, maxBarThickness: 30 },
          { label: 'Proyectado (falta)', data: restante, backgroundColor: 'rgba(193,62,116,0.25)', borderRadius: 5, maxBarThickness: 30 }
        ]
      },
      options: {
        plugins: {
          legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', font: { size: 11.5, weight: 600 } } },
          tooltip: { backgroundColor: '#241820', padding: 10, cornerRadius: 8, callbacks: { label: (c) => ` ${c.dataset.label}: $${c.parsed.y.toFixed(2)}` } }
        },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { font: { size: 11 } } },
          y: { stacked: true, beginAtZero: true, ticks: { callback: (v) => '$' + v, font: { size: 11 } }, grid: { color: 'rgba(60,35,50,0.06)' } }
        },
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 600, easing: 'easeOutQuint' }
      }
    });
  },

  proyeccionAhorro(canvasId, ahorroRealMensual, ahorroMetaMensual) {
    this.destruir(canvasId);
    const ctx = document.getElementById(canvasId);
    const meses = ['Hoy', 'Mes 1', 'Mes 2', 'Mes 3', 'Mes 4', 'Mes 5', 'Mes 6'];
    const real = [0];
    const meta = [0];
    for (let i = 1; i <= 6; i++) {
      real.push(Math.max(0, real[i - 1] + ahorroRealMensual));
      meta.push(meta[i - 1] + ahorroMetaMensual);
    }
    this._instancias[canvasId] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: meses,
        datasets: [
          { label: 'A su ritmo actual', data: real, borderColor: PALETA.accent, backgroundColor: 'rgba(193,62,116,0.1)', fill: true, tension: 0.35, borderWidth: 2.5, pointRadius: 3, pointBackgroundColor: PALETA.accent },
          { label: 'Cumpliendo la meta', data: meta, borderColor: PALETA.lavender, borderDash: [5, 4], fill: false, tension: 0.35, borderWidth: 2, pointRadius: 2, pointBackgroundColor: PALETA.lavender }
        ]
      },
      options: {
        plugins: {
          legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', font: { size: 11.5, weight: 600 } } },
          tooltip: { backgroundColor: '#241820', padding: 10, cornerRadius: 8, callbacks: { label: (c) => ` ${c.dataset.label}: $${c.parsed.y.toFixed(2)}` } }
        },
        scales: {
          y: { beginAtZero: true, ticks: { callback: (v) => '$' + v, font: { size: 11 } }, grid: { color: 'rgba(60,35,50,0.06)' } },
          x: { grid: { display: false }, ticks: { font: { size: 11 } } }
        },
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 700, easing: 'easeOutQuint' }
      }
    });
  },

  historialTasas(canvasId, historial) {
    this.destruir(canvasId);
    if (!historial.length) { this._vacio(canvasId, 'Todavía no hay historial suficiente'); return; }
    this._limpiarVacio(canvasId);
    const ctx = document.getElementById(canvasId);
    this._instancias[canvasId] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: historial.map((h) => new Date(h.fecha).toLocaleDateString('es-VE', { day: '2-digit', month: 'short' })),
        datasets: [
          { label: 'BCV', data: historial.map((h) => h.bcv_usd), borderColor: PALETA.lavender, tension: 0.3, borderWidth: 2, pointRadius: 0 },
          { label: 'Paralelo', data: historial.map((h) => h.paralelo_usd), borderColor: PALETA.accent, tension: 0.3, borderWidth: 2, pointRadius: 0 },
          { label: 'USDT P2P', data: historial.map((h) => h.usdt_venta), borderColor: PALETA.success, tension: 0.3, borderWidth: 2, pointRadius: 0 }
        ]
      },
      options: {
        plugins: {
          legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', font: { size: 11.5, weight: 600 } } },
          tooltip: { backgroundColor: '#241820', padding: 10, cornerRadius: 8 }
        },
        scales: {
          y: { ticks: { callback: (v) => 'Bs.' + v, font: { size: 11 } }, grid: { color: 'rgba(60,35,50,0.06)' } },
          x: { grid: { display: false }, ticks: { font: { size: 11 } } }
        },
        responsive: true,
        maintainAspectRatio: false
      }
    });
  }
};
