# CLAUDE.md · Lauburu Glamping

Sitio web de reservas para Lauburu Glamping (Manizales, Colombia). Un solo alojamiento, hasta 6 huéspedes.

## Documentos de referencia (léelos antes de cada tarea)
- `PLAN_DESARROLLO.md`: alcance, modelo de datos, reglas de negocio, fases y tareas.
- `REGLAS_WEB.md`: reglas obligatorias de UI (colores, tipografía, espaciado, componentes).
- `DESIGN.md`: identidad de marca y tono de voz.

## Stack
Next.js 15 (App Router) · TypeScript estricto · Tailwind v4 · PostgreSQL + Drizzle · Resend + React Email · Vitest · Playwright · Vercel.

## Estructura (npm workspaces, un solo despliegue en Vercel)
- `frontend/` (`@lauburu/frontend`): app Next.js. Páginas, componentes, rutas `app/api/*` delgadas que llaman al backend. Aquí vive `.env.local`.
- `backend/` (`@lauburu/backend`): paquete TypeScript sin servidor propio. BD y esquema Drizzle (`src/db.ts`), precios, reservas, pagos, correos y servicios, más migraciones (`drizzle/`) y pruebas Vitest. Se importa como `@lauburu/backend/<archivo>`.
- La lógica de negocio va en `backend/`; el frontend no habla con la BD directamente salvo a través de ese paquete.

## Comandos (desde la raíz)
- `npm run dev`: desarrollo
- `npm run lint`, `npm run test`, `npm run build`: deben pasar antes de dar una tarea por terminada
- `npm run db:generate`, `npm run db:migrate`: migraciones

## Forma de trabajar
- Una tarea a la vez. Antes de escribir código, lista los archivos que vas a crear o modificar y el enfoque, y espera aprobación.
- **Prefiere pocos archivos y bien organizados**: no dividas en módulos pequeños sin una razón clara. Nada de capas de abstracción "por si acaso".
- No instales dependencias nuevas sin justificarlo.
- Para pasarelas de pago (Wompi, Bold, PayPal) consulta la documentación oficial y cita la sección. No escribas integraciones de memoria.
- Al terminar: resume lo hecho, lo pendiente y cómo probarlo.

## Reglas de negocio críticas
- **El precio se calcula solo en el servidor** con `backend/src/precios.ts`. Nunca confíes en montos enviados por el cliente.
- **Solo el webhook confirma un pago.** La página de retorno solo consulta el estado.
- Toda reserva pasa por la restricción anti doble reserva de Postgres. No la elimines ni la esquives.
- Webhooks: verificar firma (401 si falla), idempotencia por `id_evento`, comparar monto y moneda, confirmar en transacción, enviar correos después del commit.
- Stock de servicios: se descuenta al confirmar el pago, dentro de una transacción.
- Fechas como `DATE` en zona `America/Bogota`. Una noche = fecha de llegada inclusiva, salida exclusiva.
- Montos en COP como enteros (centavos cuando la pasarela lo pida). PayPal cobra en USD con la TRM guardada en la reserva.

## Seguridad
- Secretos solo en variables de entorno. Nunca en el código, en logs ni en componentes de cliente (`NEXT_PUBLIC_` solo para llaves públicas).
- Valida toda entrada con Zod en el servidor.
- El panel `/panel` requiere sesión y correo en la lista permitida; protégelo en el servidor, no solo en la UI.
- No registres datos personales completos ni datos de tarjetas en logs.

## UI
- Sigue `REGLAS_WEB.md` al pie de la letra: solo tokens de color, Lora + Poppins, botones `rounded-full`, tarjetas de 12 px, mobile-first, contraste AA.
- Textos en español, tuteando, cálidos y claros. Sin "OFERTÓN", sin urgencia falsa, sin mayúsculas sostenidas.
- No redibujes el logo: usa los archivos de `public/brand/`.
