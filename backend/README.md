# @lauburu/backend

Lógica de negocio de Lauburu Glamping: esquema de BD, precios, reservas, servicio, pedidos y pagos. Es un paquete TypeScript **sin servidor propio**: lo importa el frontend (`@lauburu/frontend`) y se despliega con él en Netlify. "Levantar el backend" significa tener la base de datos lista y correr el frontend.

```ts
import { cotizarEstadia } from "@lauburu/backend/reservas";
```

Cada archivo de `src/` se exporta como `@lauburu/backend/<archivo>` (ver `exports` en `package.json`).

## Estructura

| Ruta | Contenido |
| --- | --- |
| `src/db.ts` | Esquema Drizzle (configuración, temporadas, festivos, ajustes de fecha, códigos de descuento, reservas, aliados, servicios, cupos, pedidos, pagos, eventos de pasarela, límites de peticiones) y conexión `getDb()`. |
| `src/precios.ts` | Motor de tarifas. Funciones puras, sin BD ni reloj. **Única fuente de verdad del precio** (incluye descuentos y cabalgata). |
| `src/reservas.ts` | Calendario, cotización, creación de reservas pendientes (hold), cabalgatas de la reserva y confirmación. Validación Zod de la estadía y del huésped. |
| `src/servicios.ts` | Reglas puras del carrito de servicios (sin uso desde que la cabalgata va en la reserva). |
| `src/pedidos.ts` | Catálogo, disponibilidad y pedidos de servicios (sin uso desde que la cabalgata va en la reserva). |
| `src/moneda.ts` | TRM (datos.gov.co, con respaldo de la última guardada), `hoyEnBogota()` y conversión COP → USD. |
| `src/pagos.ts` | Flujo de pago común: iniciar, capturar y procesar el webhook (firma, idempotencia, monto, transacción). |
| `src/paypal.ts` | Cliente HTTP de la API REST de PayPal (token, órdenes, verificación de firma). |
| `src/openpay.ts` | Cliente HTTP de la API REST de Openpay Colombia (cargos con tarjeta y preautorización, PSE, autenticación del webhook). |
| `src/admin.ts` | Operaciones del admin: reservas sin pago (cortesía, rifa, mantenimiento), códigos de descuento y caballos de las cabalgatas. Solo las usa `scripts/admin.ts`. |
| `scripts/semilla.ts` | Carga festivos, temporadas altas y fechas especiales de Colombia 2026–2028 y el catálogo real de cabalgatas (requiere `CORREO_ADMIN`); con `--ejemplo`, la configuración de tarifas de prueba. |
| `scripts/admin.ts` | Comandos de terminal del admin (`npm run admin`). Ver "Tareas de administración". |
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

**5. Pruebas.** Las de BD (`reservas`, `pedidos`, `pagos`, `admin`) solo corren si `DATABASE_URL_PRUEBAS` está en la terminal: Vitest no lee `.env.local`. Sin ella, se omiten.

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
npm run db:seed           # festivos (no sobrescribe los editados) + cabalgatas
npm run db:seed:ejemplo   # festivos + configuración de tarifas de prueba
npm run admin             # tareas del admin (ver abajo)
```

## Tareas de administración

No hay panel: el admin trabaja desde la terminal, en la raíz del repo. Los comandos usan la BD de `DATABASE_URL` del `.env.local`. **Si esa variable apunta a producción, los cambios son reales.** Para practicar, apunta la terminal a la BD local antes de empezar (`$env:DATABASE_URL = "postgres://…/lauburu"`).

`npm run admin` sin argumentos muestra la ayuda.

### Apartar fechas sin pago

Estas reservas quedan **confirmadas** con total $0 y ocupan las noches igual que una reserva pagada. Pasan por la misma restricción anti doble reserva, así que no pueden cruzarse con una reserva web (tampoco con una que esté pagando en ese momento). La llegada es la primera noche; la salida no cuenta como noche.

```bash
# Rifa o cortesía: se piden nombre, correo y celular de quien la recibe.
npm run admin -- reservar --tipo rifa --llegada 2026-12-20 --salida 2026-12-22 --motivo "Rifa Instagram diciembre" --nombre "Ana Pérez" --correo ana@ejemplo.com --telefono 3001234567
npm run admin -- reservar --tipo cortesia --llegada 2027-02-14 --salida 2027-02-15 --motivo "Aniversario aliado" --nombre "…" --correo … --telefono … --huespedes 2

# Mantenimiento o reparaciones: no se piden datos de huésped.
npm run admin -- reservar --tipo mantenimiento --llegada 2027-01-10 --salida 2027-01-13 --motivo "Cambio de lona"

npm run admin -- reservas                     # lo que ocupa noches desde hoy (o --desde AAAA-MM-DD)
npm run admin -- liberar LAU-XXXXXXXX         # cancela una reserva del admin y libera sus noches
```

- Si las noches ya están ocupadas, el comando muestra con qué reservas choca y no crea nada.
- No se exige el mínimo de noches ni se miran los bloqueos de `ajustes_fecha`. Un mantenimiento puede durar hasta 90 noches.
- Para una rifa o cortesía, el comando imprime el enlace `/reservas/confirmacion/<código>` para enviárselo al beneficiario. Ahí ve su reserva como "Cortesía de Lauburu" y sube su documento de identidad, que te llega por correo. Por ahora el correo de confirmación no se envía solo.
- `liberar` no toca reservas pagadas en el sitio: esas requieren un reembolso.

### Códigos de descuento

Son un porcentaje del total de la reserva del glamping (noches, personas extra y adicionales). No aplican a servicios.

```bash
npm run admin -- codigo crear PROMO15 --porcentaje 15
npm run admin -- codigo crear NAVIDAD10 --porcentaje 10 --desde 2026-12-01 --hasta 2026-12-24 --estadia-desde 2027-01-16 --estadia-hasta 2027-03-15 --usos 20 --descripcion "Campaña de navidad"
npm run admin -- codigos                      # lista con usos y vigencia
npm run admin -- codigo desactivar PROMO15
```

- `--porcentaje`: de 1 a 90. Una estadía 100 % gratis se hace como cortesía.
- `--desde` / `--hasta`: días (hora de Colombia) en que se puede usar, ambos incluidos.
- `--estadia-desde` / `--estadia-hasta`: todas las noches de la estadía deben caer en ese rango.
- `--usos`: máximo de reservas que pueden usarlo. Cuentan las confirmadas y las que se están pagando; si un pago no se completa, el uso se libera solo.
- El código no distingue mayúsculas. Desactivarlo no cambia las reservas que ya lo usaron.
- El descuento solo rebaja el alojamiento (noches, personas extra, adicionales y mascotas), no la cabalgata.

### Cabalgatas

Son el único servicio adicional: los servicios cuyo slug empieza por `cabalgata-` (hoy `cabalgata-30-minutos` y `cabalgata-hora-y-media`). Se agregan en el paso de huéspedes de la reserva y se pagan en el mismo pago, con cualquier pasarela. Va **todo el grupo**, un caballo por persona: el grupo base y los adultos y niños adicionales (los menores de 4 años no montan ni pagan). Se elige cualquier día de la estadía; la hora se coordina por WhatsApp. Si una cabalgata tuviera turnos, el día de llegada solo se ofrecen desde el check-in y el de salida, solo antes del check-out.

Cada cabalgata tiene una cantidad fija de caballos por día (`servicios.capacidad_turno`, 6 por defecto). Un día puede tener otra cantidad, o cerrarse, con una fila en `cupos_servicio`. Los caballos se ocupan mientras la reserva está confirmada o con el hold vigente. Al confirmar el pago, cualquier pasarela pasa por `confirmarReserva`, que vuelve a contarlos: si cerraste el día mientras el huésped pagaba, el pago queda `requiere_reembolso`.

```bash
npm run admin -- cabalgata                                    # cabalgatas, caballos, precio y próximas reservadas
npm run admin -- cabalgata cerrar --fecha 2027-01-10          # todas las cabalgatas ese día
npm run admin -- cabalgata cerrar --fecha 2027-01-10 --servicio cabalgata-hora-y-media
npm run admin -- cabalgata capacidad --fecha 2027-01-11 --capacidad 4
npm run admin -- cabalgata abrir --fecha 2027-01-10          # quita las excepciones de ese día
npm run admin -- cabalgata capacidad --capacidad 8            # sin --fecha: todos los días
npm run admin -- cabalgata precio --servicio cabalgata-30-minutos --valor 65000   # por caballo
```

Cerrar un día no cancela las cabalgatas que ya estaban reservadas: el comando las lista para que les avises. Ojo: `npm run db:seed` vuelve a poner el precio y los textos del catálogo de la semilla (no toca los caballos por día).

## Reglas que no se negocian

- **El precio se calcula solo aquí**, con `precios.ts`. Nunca uses montos enviados por el cliente.
- **Anti doble reserva:** la migración `0002_reservas_sin_cruce.sql` crea una restricción `EXCLUDE` que impide que dos reservas pendientes o confirmadas compartan una noche. No la elimines ni la esquives.
- **Fechas** como `DATE` en `America/Bogota`, en texto `YYYY-MM-DD`. Una noche = llegada inclusiva, salida exclusiva.
- **Montos** en COP como enteros. PayPal cobra en USD; la TRM usada queda guardada en `pagos`.
- **Cupos de la cabalgata:** el hold de la reserva los aparta hasta `expira_en`; al confirmar el pago se vuelven a contar dentro de la transacción del webhook (`confirmarReserva`).
- **Pagos:** solo el webhook confirma un pago (firma, idempotencia por `id_evento`, monto y moneda, transacción, correos después del commit).
- Toda entrada externa se valida con Zod en este paquete.

Detalle completo en `CLAUDE.md`, en la raíz.
