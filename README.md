# Finanzas en pareja

<!-- teaser:start -->
<p align="center">
<img src="docs/screenshots/01-inicio.jpg" width="32%" alt="Panel de inicio: ingresos, gastos, ahorro, deuda, tasas de Venezuela y proyección de fin de mes (datos de demostración)"> <img src="docs/screenshots/07-nombres-editables.jpg" width="32%" alt="Los nombres de la pareja son editables: aquí renombrados a Ana y Luis, y se reflejan en todo el panel"> <img src="docs/screenshots/02-gastos.jpg" width="32%" alt="Registro de gastos con persona, bolsillo y categoría">
</p>

<details><summary>Más capturas</summary>

<p align="center">
<img src="docs/screenshots/03-ingresos.jpg" width="48%" alt="Ingresos fijos por persona y su estimado mensual" title="Ingresos fijos por persona y su estimado mensual"> <img src="docs/screenshots/04-deudas.jpg" width="48%" alt="Deudas y compras en cuotas estilo Cashea con progreso de pago" title="Deudas y compras en cuotas estilo Cashea con progreso de pago"> <img src="docs/screenshots/05-ajustes-nombres.jpg" width="48%" alt="Ajustes: nombres, ingresos fijos, meta de ahorro y categorías" title="Ajustes: nombres, ingresos fijos, meta de ahorro y categorías"> <img src="docs/screenshots/06-movil.jpg" width="48%" alt="Versión móvil del panel" title="Versión móvil del panel">
</p>

</details>
<!-- teaser:end -->


Panel para llevar en pareja el control de gastos, ingresos, bolsillos, deudas, inversión y ahorro, con las tasas de cambio de Venezuela en tiempo real. Funciona desde el teléfono y guarda todo en una base de datos SQLite remota (Turso).

> Los datos de las capturas son de demostración. Los nombres de la pareja son **editables**: se cambian en *Ajustes → Nombres* y se reflejan en todo el panel.

## Qué hace

- **Gastos e ingresos** por persona, bolsillo y categoría, con monto en USD, VES, EUR o USDT y conversión con la tasa del día.
- **Bolsillos** (efectivo, Zelle, USDT, cuentas) con saldo calculado.
- **Deudas** con pagos parciales y **compras en cuotas estilo Cashea** (inicial más cuotas iguales cada 14 días).
- **Inversión y ahorro**: meta por porcentaje o por monto fijo, y proyección a 6 meses.
- **Proyección de fin de mes** combinando el ritmo actual con el promedio de los últimos meses.
- **Fotos de facturas** adjuntas a cada movimiento (Vercel Blob).
- Acceso con una sola contraseña compartida, sesión de 90 días por dispositivo.

## Stack

Node.js sin framework en el servidor · JavaScript, HTML y CSS en el cliente (gráficas propias) · libSQL / Turso · Vercel (funciones y hosting) · Vercel Blob.

## Correrlo en local

No necesita cuentas: libSQL acepta un archivo como base de datos.

```bash
npm install
TURSO_DATABASE_URL=file:./data/finanzas.db npm start
```

Abre http://localhost:4173 (o el puerto de `PORT`). En local no pide contraseña.

## Publicarlo (Vercel + Turso)

1. Crea una base en [Turso](https://turso.tech) y copia su URL y su token.
2. Importa este repositorio en [Vercel](https://vercel.com) y conecta un almacén **Blob** privado (agrega `BLOB_READ_WRITE_TOKEN`).
3. En *Settings → Environment Variables* agrega: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `APP_PASSWORD` (la contraseña que usarán) y `SESSION_SECRET` (un texto largo y aleatorio, por ejemplo `openssl rand -hex 32`).
4. Despliega. La app pide la contraseña una vez por dispositivo.

Hay un ejemplo de variables en `.env.example`.
