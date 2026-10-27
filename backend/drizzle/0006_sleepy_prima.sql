ALTER TABLE "temporadas" DROP CONSTRAINT "temporadas_precio";--> statement-breakpoint
ALTER TABLE "temporadas" ALTER COLUMN "precio_noche" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ajustes_fecha" ADD COLUMN "especial" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "configuracion" ADD COLUMN "precio_temporada" integer DEFAULT 560000 NOT NULL;--> statement-breakpoint
ALTER TABLE "configuracion" ADD COLUMN "precio_fecha_especial" integer DEFAULT 650000 NOT NULL;--> statement-breakpoint
ALTER TABLE "configuracion" ADD COLUMN "max_adicionales" integer DEFAULT 4 NOT NULL;--> statement-breakpoint
ALTER TABLE "configuracion" ADD COLUMN "precio_adicional_adulto" integer DEFAULT 90000 NOT NULL;--> statement-breakpoint
ALTER TABLE "configuracion" ADD COLUMN "precio_adicional_nino" integer DEFAULT 60000 NOT NULL;--> statement-breakpoint
ALTER TABLE "reservas" ADD COLUMN "adultos_adicionales" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "reservas" ADD COLUMN "ninos_adicionales" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "reservas" ADD COLUMN "menores_adicionales" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "configuracion" ADD CONSTRAINT "configuracion_tarifas_positivas" CHECK ("configuracion"."precio_temporada" > 0 and "configuracion"."precio_fecha_especial" > 0);--> statement-breakpoint
ALTER TABLE "configuracion" ADD CONSTRAINT "configuracion_adicionales" CHECK ("configuracion"."max_adicionales" >= 0 and "configuracion"."precio_adicional_adulto" >= 0 and "configuracion"."precio_adicional_nino" >= 0);--> statement-breakpoint
ALTER TABLE "reservas" ADD CONSTRAINT "reservas_adicionales" CHECK ("reservas"."adultos_adicionales" >= 0 and "reservas"."ninos_adicionales" >= 0 and "reservas"."menores_adicionales" >= 0);--> statement-breakpoint
ALTER TABLE "temporadas" ADD CONSTRAINT "temporadas_precio" CHECK ("temporadas"."precio_noche" is null or "temporadas"."precio_noche" > 0);--> statement-breakpoint
-- Tarifas del glamping (2026-10-26): entre semana 420 000 y fin de semana 490 000.
UPDATE "configuracion" SET "precio_base" = 420000, "precio_alto" = 490000;
