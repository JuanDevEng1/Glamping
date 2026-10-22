-- Regla anti doble reserva (PLAN_DESARROLLO.md §3). OBLIGATORIA: no eliminar.
-- Impide que dos reservas pendientes o confirmadas compartan una noche,
-- incluso si se crean al mismo tiempo. Noches = [llegada, salida).
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "reservas"
  ADD CONSTRAINT "reservas_sin_cruce"
  EXCLUDE USING gist (daterange("fecha_llegada", "fecha_salida", '[)') WITH &&)
  WHERE ("estado" IN ('pendiente', 'confirmada'));
