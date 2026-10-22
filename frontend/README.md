# @lauburu/frontend

Sitio web de Lauburu Glamping en Next.js 15 (App Router), TypeScript y Tailwind v4. Contiene las páginas, los componentes y rutas `app/api/*` delgadas. La lógica de negocio vive en [`@lauburu/backend`](../backend/README.md): este paquete no habla con la BD directamente.

## Estructura

| Ruta | Contenido |
| --- | --- |
| `app/page.tsx` | Inicio. |
| `app/reservas/` | Flujo de reserva (`page.tsx`), server actions (`acciones.ts`) y confirmación (`confirmacion/[codigo]`). |
| `app/servicios/` | Catálogo, detalle (`[slug]`), pago, estado del pedido (`pedido/[codigo]`) y server actions. |
| `app/terminos/` | Términos y condiciones. |
| `app/api/calendario/` | `GET ?mes=YYYY-MM`: precios y disponibilidad del mes, sin caché. |
| `components/` | Layout (`Header`, `Footer`, `Container`), primitivas de UI (`ui.tsx`), `reserva/` y `servicios/`. |
| `lib/` | Formato de montos y fechas (`formato.ts`) y datos del sitio (`sitio.ts`). |
| `public/brand/` | Logo y recursos de marca. Úsalos tal cual, no los redibujes. |

## Puesta en marcha

1. Desde la raíz: `npm install`.
2. Copia `.env.example` como `.env.local` y completa `DATABASE_URL`. Este archivo también lo lee el backend (migraciones y semilla). Nunca lo subas al repositorio.
3. Prepara la BD: `npm run db:migrate` y `npm run db:seed:ejemplo`.
4. `npm run dev` y abre http://localhost:3000.

## Comandos

Desde la raíz del repo:

```bash
npm run dev     # next dev --turbopack
npm run lint    # eslint de este paquete + typecheck del backend
npm run build   # build de producción
npm run start   # sirve el build
```

`lint`, `test` y `build` deben pasar antes de dar una tarea por terminada.

## Reglas

- **Montos:** el cliente nunca envía precios. Las acciones y rutas llaman al backend, que recalcula todo en el servidor.
- **Pagos:** la página de retorno solo consulta el estado; solo el webhook confirma.
- **Secretos:** solo en variables de entorno. `NEXT_PUBLIC_` únicamente para llaves públicas.
- **UI:** sigue `REGLAS_WEB.md` al pie de la letra (tokens de color, Lora + Poppins, botones `rounded-full`, tarjetas de 12 px, mobile-first, contraste AA). Tono de marca en `DESIGN.md`.
- **Textos** en español, tuteando, cálidos y claros.
