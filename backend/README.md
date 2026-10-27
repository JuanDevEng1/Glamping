# @lauburu/backend

Lógica de negocio de Lauburu Glamping: esquema de BD, precios, reservas, servicios, pedidos y pagos. Es un paquete TypeScript **sin servidor propio**: lo importa el frontend (`@lauburu/frontend`) y se despliega con él en Netlify. "Levantar el backend" significa tener la base de datos lista y correr el frontend.

```ts
import { cotizarEstadia } from "@lauburu/backend/reservas";
```

Cada archivo de `src/` se exporta como `@lauburu/backend/<archivo>` (ver `exports` en `package.json`).

## Estructura

| Ruta | Contenido |
| --- | --- |
| `src/db.ts` | Esquema Drizzle (configuración, temporadas, festivos, ajustes de fecha, reservas, aliados, servicios, cupos, pedidos, pagos, eventos de pasarela) y conexión `getDb()`. |
| `src/precios.ts` | Motor de tarifas. Funciones puras, sin BD ni reloj. **Única fuente de verdad del precio.** |
| `src/reservas.ts` | Calendario, cotización, creación de reservas pendientes (hold) y confirmación. Validación Zod de la estadía y del huésped. |
| `src/servicios.ts` | Reglas puras del carrito de servicios (categorías, unidades de precio, cotización del carrito). |
| `src/pedidos.ts` | Catálogo, disponibilidad por fecha/turno, pedidos de servicios y confirmación (descuenta cupos y stock). |
| `src/moneda.ts` | TRM (datos.gov.co, con respaldo de la última guardada), `hoyEnBogota()` y conversión COP → USD. |
| `src/pagos.ts` | Flujo de pago común: iniciar, capturar y procesar el webhook (firma, idempotencia, monto, transacción). |
| `src/paypal.ts` | Cliente HTTP de la API REST de PayPal (token, órdenes, verificación de firma). |
| `scripts/semilla.ts` | Carga festivos de Colombia 2026–2028; con `--ejemplo`, datos de prueba. |
| `drizzle/` | Migraciones SQL generadas por drizzle-kit (la `0002` es manual: no la toques). |
| `tests/` | Pruebas Vitest. |

## Levantar en local

Requisitos: Node.js 20.12 o superior y Docker (o cualquier PostgreSQL 17).

**1. PostgreSQL en Docker** (solo la primera vez):

```bash
docker run -d --name lauburu-pg \
  -e POSTGRES_PASSWORD=<tu-clave> -e POSTGRES_DB=lauburu \
  -p 54329:5432 -v lauburu-pg-datos:/var/lib/postgresql/data postgres:17
docker exec lauburu-pg createdb -U postgres lauburu_pruebas
```

Las siguientes veces basta con `docker start lauburu-pg`.

**2. Variables de entorno.** Copia `frontend/.env.example` como `frontend/.env.local` y completa:

```bash
DATABASE_URL=postgres://postgres:<tu-clave>@localhost:54329/lauburu
DATABASE_URL_PRUEBAS=postgres://postgres:<tu-clave>@localhost:54329/lauburu_pruebas
```

Para la BD local no hace falta `?sslmode=require`; para Supabase o Neon, sí.

**3. Dependencias, migraciones y datos** (desde la raíz del repo):

```bash
npm install
npm run db:migrate          # aplica las migraciones en DATABASE_URL
npm run db:seed:ejemplo     # festivos + configuración, temporadas y servicios de prueba
npm run dev                 # http://localhost:3000
```

**4. Migrar también la BD de pruebas.** `db:migrate` usa `DATABASE_URL`, pero una variable que ya esté en la terminal tiene prioridad sobre `.env.local`:

```powershell
# PowerShell
$env:DATABASE_URL = "postgres://postgres:<tu-clave>@localhost:54329/lauburu_pruebas"
npm run db:migrate
Remove-Item Env:DATABASE_URL
```

```bash
# Git Bash
DATABASE_URL="postgres://postgres:<tu-clave>@localhost:54329/lauburu_pruebas" npm run db:migrate
```

**5. Pruebas.** Las de BD (`reservas`, `pedidos`, `pagos`) solo corren si `DATABASE_URL_PRUEBAS` está en la terminal: Vitest no lee `.env.local`. Sin ella, se omiten.

```powershell
$env:DATABASE_URL_PRUEBAS = "postgres://postgres:<tu-clave>@localhost:54329/lauburu_pruebas"
npm run test
```

### Después de cada migración nueva

Cada vez que llegue una migración (por ejemplo, tras un `git pull`), corre `npm run db:migrate` en **todas** las BD que uses: la de `DATABASE_URL`, la de pruebas y la de Supabase si trabajas contra ella. Si no lo haces, la app falla con un error como `Failed query: select … "trm_valor" … from "configuracion"` (`column … does not exist`): el código ya espera columnas que la BD aún no tiene.

### Probar PayPal en local

1. Crea una app en https://developer.paypal.com/dashboard (modo sandbox) y llena `PAYPAL_ENTORNO=sandbox`, `PAYPAL_CLIENT_ID` y `PAYPAL_CLIENT_SECRET`.
2. PayPal solo envía webhooks por HTTPS al puerto 443. Expón tu servidor con un túnel, por ejemplo `cloudflared tunnel --url http://localhost:3000`.
3. En la app de PayPal, crea un webhook hacia `https://<túnel>/api/webhooks/paypal` con los eventos `PAYMENT.CAPTURE.COMPLETED`, `.DECLINED`, `.DENIED`, `.REFUNDED` y `.REVERSED`. Copia su id en `PAYPAL_WEBHOOK_ID`.
4. Paga con una cuenta comprador de sandbox. La verificación de firma **no funciona con los eventos simulados** del dashboard: usa pagos de sandbox reales.

Sin las variables de PayPal, el sitio funciona igual, pero el paso de pago solo ofrece WhatsApp.

## Variables de entorno

No hay `.env` propio: `drizzle.config.ts` y la semilla leen `../frontend/.env.local`. En Netlify y CI las variables vienen del entorno.

- `DATABASE_URL`: PostgreSQL (con `?sslmode=require` si es remota).
- `DATABASE_URL_PRUEBAS` (opcional): BD **solo de pruebas**, con migraciones aplicadas. Las pruebas crean y borran reservas, pedidos y pagos. Nunca apuntes aquí la BD de producción.
- `PAYPAL_ENTORNO`: `sandbox` o `live`.
- `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`: credenciales de la app de PayPal. El secreto solo se usa en el servidor.
- `PAYPAL_WEBHOOK_ID`: id del webhook, para verificar la firma de cada evento.

## Comandos

Desde la raíz del repo:

```bash
npm run test              # Vitest
npm run lint              # incluye tsc --noEmit de este paquete
npm run db:generate       # genera una migración a partir de src/db.ts
npm run db:migrate        # aplica migraciones pendientes en DATABASE_URL
npm run db:seed           # festivos (no sobrescribe los editados en el panel)
npm run db:seed:ejemplo   # festivos + configuración, temporadas y servicios de prueba
```

## Reglas que no se negocian

- **El precio se calcula solo aquí**, con `precios.ts`. Nunca uses montos enviados por el cliente.
- **Anti doble reserva:** la migración `0002_reservas_sin_cruce.sql` crea una restricción `EXCLUDE` que impide que dos reservas pendientes o confirmadas compartan una noche. No la elimines ni la esquives.
- **Fechas** como `DATE` en `America/Bogota`, en texto `YYYY-MM-DD`. Una noche = llegada inclusiva, salida exclusiva.
- **Montos** en COP como enteros. PayPal cobra en USD; la TRM usada queda guardada en `pagos`.
- **Stock de servicios:** un pedido pendiente aparta cupos hasta `expira_en`; el stock se descuenta solo al confirmar el pago, dentro de una transacción.
- **Pagos:** solo el webhook confirma un pago (firma, idempotencia por `id_evento`, monto y moneda, transacción, correos después del commit).
- Toda entrada externa se valida con Zod en este paquete.

Detalle completo en `CLAUDE.md`, en la raíz.
