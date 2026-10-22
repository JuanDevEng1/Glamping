# Lauburu Glamping

Sitio web de reservas para Lauburu Glamping (Manizales, Colombia): un solo alojamiento para hasta 6 huéspedes, con calendario de precios, reservas en línea y venta de servicios adicionales (tours, planes en fincas, gastronomía, decoración y transporte).

## Stack

Next.js 15 (App Router) · TypeScript estricto · Tailwind v4 · PostgreSQL + Drizzle · Zod · Vitest · Vercel.

## Estructura

Monorepo con npm workspaces y un solo despliegue:

| Ruta | Contenido |
| --- | --- |
| [`frontend/`](frontend/README.md) | `@lauburu/frontend`: app Next.js con páginas, componentes y rutas `app/api/*` delgadas. Aquí vive `.env.local`. |
| [`backend/`](backend/README.md) | `@lauburu/backend`: lógica de negocio sin servidor propio. Esquema y BD, precios, reservas, servicios, migraciones y pruebas. |
| `*.html` | Prototipos estáticos de diseño (servicios, detalle de servicio y carrito). No forman parte de la app. |
| `CLAUDE.md` | Reglas de trabajo, de negocio y de seguridad del proyecto. |

## Puesta en marcha

Requisitos: Node.js 20.12 o superior y una base de datos PostgreSQL (Neon o Supabase).

```bash
npm install
cp frontend/.env.example frontend/.env.local   # completa DATABASE_URL
npm run db:migrate
npm run db:seed:ejemplo                         # festivos + datos de prueba
npm run dev                                     # http://localhost:3000
```

## Comandos

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Servidor de desarrollo. |
| `npm run build` / `npm run start` | Build de producción y servidor. |
| `npm run lint` | ESLint del frontend y typecheck del backend. |
| `npm run test` | Pruebas Vitest del backend. |
| `npm run format` | Prettier sobre todo el repo. |
| `npm run db:generate` | Genera una migración a partir del esquema. |
| `npm run db:migrate` | Aplica las migraciones pendientes. |
| `npm run db:seed` / `npm run db:seed:ejemplo` | Festivos de Colombia / festivos más datos de prueba. |

`lint`, `test` y `build` deben pasar antes de integrar cambios.

## Ramas

- `main`: versión estable.
- `dev`: integración del trabajo en curso.

## Despliegue

La app se despliega en Vercel: necesita servidor (server actions, rutas API) y base de datos, así que no funciona en un hosting estático. Las variables de entorno se configuran en el panel de Vercel y nunca se suben al repositorio.

## Reglas clave

- El precio se calcula solo en el servidor; nunca se confía en montos enviados por el cliente.
- Una restricción de Postgres impide reservas que se crucen; no se elimina ni se esquiva.
- Solo el webhook de la pasarela confirma un pago.
- Fechas en `America/Bogota`; montos en COP como enteros.

El detalle completo está en [`CLAUDE.md`](CLAUDE.md).
