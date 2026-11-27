ALTER TABLE "reservas" ADD COLUMN "cabalgata_fecha" date;--> statement-breakpoint
ALTER TABLE "reservas" ADD COLUMN "cabalgata_turno" text;--> statement-breakpoint
ALTER TABLE "reservas" ADD COLUMN "cabalgata_personas" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "reservas" ADD COLUMN "cabalgata_cop" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "servicios" ADD COLUMN "capacidad_turno" integer DEFAULT 6 NOT NULL;--> statement-breakpoint
ALTER TABLE "reservas" ADD CONSTRAINT "reservas_cabalgata" CHECK (("reservas"."cabalgata_fecha" is null and "reservas"."cabalgata_turno" is null and "reservas"."cabalgata_personas" = 0 and "reservas"."cabalgata_cop" = 0) or ("reservas"."cabalgata_fecha" is not null and "reservas"."cabalgata_turno" is not null and "reservas"."cabalgata_personas" > 0 and "reservas"."cabalgata_cop" >= 0));--> statement-breakpoint
ALTER TABLE "servicios" ADD CONSTRAINT "servicios_capacidad_turno" CHECK ("servicios"."capacidad_turno" >= 0);--> statement-breakpoint
-- La edad mínima de la cabalgata no está confirmada (2026-11-26): se quita de la condición.
UPDATE "servicios" SET "condiciones" = '[]'::jsonb WHERE "slug" = 'cabalgata-al-mirador' AND "condiciones" @> '[{"titulo": "Edad mínima"}]'::jsonb;
