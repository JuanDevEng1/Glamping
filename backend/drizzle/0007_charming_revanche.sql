ALTER TABLE "configuracion" ADD COLUMN "precio_mascota" integer DEFAULT 50000 NOT NULL;--> statement-breakpoint
ALTER TABLE "reservas" ADD COLUMN "mascotas" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "reservas" ADD COLUMN "alergias" text;--> statement-breakpoint
ALTER TABLE "reservas" ADD COLUMN "contacto_emergencia" text;--> statement-breakpoint
ALTER TABLE "reservas" ADD COLUMN "telefono_emergencia" text;--> statement-breakpoint
ALTER TABLE "configuracion" ADD CONSTRAINT "configuracion_mascotas" CHECK ("configuracion"."precio_mascota" >= 0);--> statement-breakpoint
ALTER TABLE "reservas" ADD CONSTRAINT "reservas_mascotas" CHECK ("reservas"."mascotas" >= 0);