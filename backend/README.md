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
| `src/openpay.ts` | Cliente HTTP de la API REST de Openpay Colombia (cargos con tarjeta y preautorización, PSE, autenticación del webhook). |
| `scripts/semilla.ts` | Carga festivos de Colombia 2026–2028 y el catálogo real (cabalgatas, con cupos para 90 días; requiere `CORREO_ADMIN`); con `--ejemplo`, también la configuración de tarifas de prueba. |
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
npm run db:seed:ejemplo     # festivos + configuración de tarifas de prueba
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
3. En la app de PayPal, crea un webhook hacia `https://<túnel>/api/webhooks/paypal` con los eventos `PAYMENT.CAPTURE.COMPLETED`, `.DECLINED`, `.DENIED`, `.REFUNDED` y `.REVERSED`, y `PAYMENT.AUTHORIZATION.CREATED` y `.VOIDED` (depósito de garantía). Copia su id en `PAYPAL_WEBHOOK_ID`.
4. Paga con una cuenta comprador de sandbox. La verificación de firma **no funciona con los eventos simulados** del dashboard: usa pagos de sandbox reales.

Sin las variables de PayPal, el sitio funciona igual, pero el paso de pago solo ofrece WhatsApp.

### Depósito de garantía (autorizar y capturar)

El depósito de garantía es **obligatorio**: `configuracion.monto_deposito` COP (por defecto 100 000; con 0 no se pide). Se autoriza en el paso de pago, **antes del cobro y con la misma pasarela**. Aparta el dinero, no lo cobra.

- **Cuándo.** Solo en el paso de pago, con la reserva pendiente y su hold vigente. Con tarjeta de Openpay, el depósito y el pago van en el mismo clic (un token para cada cargo). Con PSE, el depósito va primero con tarjeta, porque PSE no permite retener. Con PayPal hay dos botones: primero la orden `AUTHORIZE` del depósito y después la del pago.
- **Sin depósito no hay pago.** `iniciarPagoPaypal`, `pagarConTarjetaOpenpay` e `iniciarPseOpenpay` responden `falta_deposito` si la reserva no tiene un depósito vigente de la misma pasarela (`depositoListo` en `src/pagos.ts`).
- **Vencimiento.** El banco libera la retención solo: PayPal a los 29 días y Openpay a los ~7 (`DIAS_VIGENCIA_PREAUTORIZACION`). En reservas hechas con anticipación, la retención vence antes de la estadía y ya no se puede cobrar. Es una decisión aceptada del negocio.
- **Reserva que no se completa.** `liberarDepositosHuerfanos` anula la autorización en PayPal (`/void`) o reembolsa la preautorización en Openpay de las reservas no confirmadas cuyo hold venció hace más de 2 horas. El margen es para que un PSE tardío todavía pueda confirmar. No hay tareas programadas: se llama después de cada webhook y al crear una reserva.
- **Estados** en `pagos` (`concepto = 'deposito'`): `creado` → `autorizado` (webhook `PAYMENT.AUTHORIZATION.CREATED` o respuesta de Openpay) → `cobrado`, `anulado` (anulado, liberado o vencido) o `reembolsado`. Nunca cambian la reserva.
- **Cobrar o liberar.** No hay panel. El admin recibe un correo cuando la reserva queda pagada con el depósito autorizado. Después de la salida, cobra el depósito (total o parcial) o lo libera desde PayPal › Actividad o desde el dashboard de Openpay. PayPal garantiza el cobro solo durante los 3 primeros días (honor period); después depende de los fondos del huésped.

### Probar Openpay en local

Openpay Colombia es la segunda pasarela (pesos colombianos): tarjeta tokenizada con openpay.js, PSE y depósito preautorizado. PayPal sigue igual; el huésped elige.

1. En el dashboard de **sandbox** de Openpay copia el ID de comercio y las llaves privada y pública en `OPENPAY_MERCHANT_ID`, `OPENPAY_LLAVE_PRIVADA` y `OPENPAY_LLAVE_PUBLICA` (`OPENPAY_ENTORNO=sandbox`).
2. Inventa un usuario y una clave larga para el webhook y ponlos en `OPENPAY_WEBHOOK_USUARIO` y `OPENPAY_WEBHOOK_CLAVE`. Openpay solo autentica webhooks con HTTP Basic, así que además el backend vuelve a consultar cada cargo en la API antes de decidir.
3. Expón tu servidor con un túnel (`cloudflared tunnel --url http://localhost:3000`) y, en el dashboard › Webhooks, agrega `https://<túnel>/api/webhooks/openpay` con ese usuario y clave. Openpay manda un evento `verification`: el código aparece en el log del servidor (`Openpay: código de verificación del webhook: …`); escríbelo en el dashboard para verificar el webhook.
4. Paga con la tarjeta de prueba `4111 1111 1111 1111` (cualquier nombre, vencimiento futuro y CVV de 3 dígitos). PSE abre el checkout de prueba de Openpay.

Lo que se verificó en sandbox el 2026-11-05 (no está en la referencia pública de Colombia; detalle en `src/openpay.ts`):

- `capture: false` deja el cargo en `in_progress` (preautorizado). El dashboard muestra **Confirmar** y **Reembolsar**.
- Confirmar por API (`/capture`) acepta un monto menor → `completed`. Reembolsar una preautorización la libera → `cancelled`.
- PSE va por `POST /pse` y devuelve la URL del checkout; el pago se identifica por nuestro `order_id`.

**Depósito con Openpay.** Estados en `pagos`: `autorizado` (`in_progress`, se marca con la respuesta de la API porque Openpay no garantiza un webhook para la preautorización) → `cobrado` (`completed`) o `anulado` (`cancelled`). El admin, después de la salida, abre el cargo en el dashboard: **Confirmar** para cobrar daños (si no deja poner un monto menor, confirma el total y reembolsa la diferencia) o **Reembolsar** para liberarlo. La preautorización dura **7 días** según el plugin oficial de Openpay para Magento, no según la API (`DIAS_VIGENCIA_PREAUTORIZACION`, por confirmar con Openpay).

## Variables de entorno

No hay `.env` propio: `drizzle.config.ts` y la semilla leen `../frontend/.env.local`. En Netlify y CI las variables vienen del entorno.

- `DATABASE_URL`: PostgreSQL (con `?sslmode=require` si es remota).
- `DATABASE_URL_PRUEBAS` (opcional): BD **solo de pruebas**, con migraciones aplicadas. Las pruebas crean y borran reservas, pedidos y pagos. Nunca apuntes aquí la BD de producción.
- `PAYPAL_ENTORNO`: `sandbox` o `live`.
- `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`: credenciales de la app de PayPal. El secreto solo se usa en el servidor.
- `PAYPAL_WEBHOOK_ID`: id del webhook, para verificar la firma de cada evento.
- `OPENPAY_ENTORNO`: `sandbox` o `produccion`.
- `OPENPAY_MERCHANT_ID`, `OPENPAY_LLAVE_PRIVADA` (solo servidor), `OPENPAY_LLAVE_PUBLICA` (solo crea tokens en el navegador).
- `OPENPAY_WEBHOOK_USUARIO`, `OPENPAY_WEBHOOK_CLAVE`: HTTP Basic del webhook; los defines tú al registrarlo.
- `SITIO_URL` (opcional): URL pública para el retorno de PSE. En Netlify se usa `URL`.

## Comandos

Desde la raíz del repo:

```bash
npm run test              # Vitest
npm run lint              # incluye tsc --noEmit de este paquete
npm run db:generate       # genera una migración a partir de src/db.ts
npm run db:migrate        # aplica migraciones pendientes en DATABASE_URL
npm run db:seed           # festivos (no sobrescribe los editados) + cabalgatas y sus cupos
npm run db:seed:ejemplo   # festivos + configuración de tarifas de prueba
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
