# @lauburu/backend

Lógica de negocio de Lauburu Glamping: esquema de BD, precios, reservas, servicios y pedidos. Es un paquete TypeScript **sin servidor propio**: lo importa el frontend (`@lauburu/frontend`) y se despliega con él en Vercel.

```ts
import { cotizarEstadia } from "@lauburu/backend/reservas";
```

Cada archivo de `src/` se exporta como `@lauburu/backend/<archivo>` (ver `exports` en `package.json`).

## Estructura

| Ruta | Contenido |
| --- | --- |
| `src/db.ts` | Esquema Drizzle (configuración, temporadas, festivos, ajustes de fecha, reservas, aliados, servicios, cupos, pedidos) y conexión `getDb()`. |
| `src/precios.ts` | Motor de tarifas. Funciones puras, sin BD ni reloj. **Única fuente de verdad del precio.** |
| `src/reservas.ts` | Calendario, cotización y creación de reservas pendientes (hold). Validación Zod de la estadía y del huésped. |
| `src/servicios.ts` | Reglas puras del carrito de servicios (categorías, unidades de precio, cotización del carrito). |
| `src/pedidos.ts` | Catálogo, disponibilidad por fecha/turno y pedidos de servicios. Usa la BD. |
| `src/moneda.ts` | TRM vigente desde datos.gov.co y `hoyEnBogota()`. |
| `scripts/semilla.ts` | Carga festivos de Colombia 2026–2028; con `--ejemplo`, datos de prueba. |
| `drizzle/` | Migraciones SQL generadas por drizzle-kit. |
| `tests/` | Pruebas Vitest. |

## Variables de entorno

No hay `.env` propio: `drizzle.config.ts` y la semilla leen `../frontend/.env.local`. En Vercel y CI las variables vienen del entorno.

- `DATABASE_URL`: PostgreSQL con SSL (`?sslmode=require`).
- `DATABASE_URL_PRUEBAS` (opcional): BD **solo de pruebas**, con migraciones aplicadas. La usa `tests/reservas.test.ts`, que crea y borra reservas. Nunca apuntes aquí la BD de producción.

## Comandos

Desde la raíz del repo:

```bash
npm run test              # Vitest
npm run lint              # incluye tsc --noEmit de este paquete
npm run db:generate       # genera una migración a partir de src/db.ts
npm run db:migrate        # aplica migraciones pendientes
npm run db:seed           # festivos (no sobrescribe los editados en el panel)
npm run db:seed:ejemplo   # festivos + configuración, temporadas y servicios de prueba
```

## Reglas que no se negocian

- **El precio se calcula solo aquí**, con `precios.ts`. Nunca uses montos enviados por el cliente.
- **Anti doble reserva:** la migración `0002_reservas_sin_cruce.sql` crea una restricción `EXCLUDE` que impide que dos reservas pendientes o confirmadas compartan una noche. No la elimines ni la esquives.
- **Fechas** como `DATE` en `America/Bogota`, en texto `YYYY-MM-DD`. Una noche = llegada inclusiva, salida exclusiva.
- **Montos** en COP como enteros.
- **Stock de servicios:** un pedido pendiente aparta cupos hasta `expira_en`; el stock se descuenta solo al confirmar el pago, dentro de una transacción.
- **Pagos:** solo el webhook confirma un pago (firma, idempotencia por `id_evento`, monto y moneda, transacción, correos después del commit).
- Toda entrada externa se valida con Zod en este paquete.

Detalle completo en `PLAN_DESARROLLO.md` y `CLAUDE.md` en la raíz.
