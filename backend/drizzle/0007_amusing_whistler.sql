CREATE TABLE "codigos_descuento" (
	"id" serial PRIMARY KEY NOT NULL,
	"codigo" text NOT NULL,
	"porcentaje" integer NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"valido_desde" date,
	"valido_hasta" date,
	"estadia_desde" date,
	"estadia_hasta" date,
	"usos_maximos" integer,
	"descripcion" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "codigos_descuento_codigo_unique" UNIQUE("codigo"),
	CONSTRAINT "codigos_descuento_porcentaje" CHECK ("codigos_descuento"."porcentaje" between 1 and 90),
	CONSTRAINT "codigos_descuento_usos" CHECK ("codigos_descuento"."usos_maximos" is null or "codigos_descuento"."usos_maximos" >= 1),
	CONSTRAINT "codigos_descuento_mayusculas" CHECK ("codigos_descuento"."codigo" = upper("codigos_descuento"."codigo"))
);
--> statement-breakpoint
ALTER TABLE "reservas" ADD COLUMN "origen" text DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE "reservas" ADD COLUMN "nota_admin" text;--> statement-breakpoint
ALTER TABLE "reservas" ADD COLUMN "codigo_descuento_id" integer;--> statement-breakpoint
ALTER TABLE "reservas" ADD COLUMN "descuento_cop" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "reservas" ADD CONSTRAINT "reservas_codigo_descuento_id_codigos_descuento_id_fk" FOREIGN KEY ("codigo_descuento_id") REFERENCES "public"."codigos_descuento"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservas" ADD CONSTRAINT "reservas_origen" CHECK ("reservas"."origen" in ('web', 'cortesia', 'rifa', 'mantenimiento'));--> statement-breakpoint
ALTER TABLE "reservas" ADD CONSTRAINT "reservas_descuento" CHECK ("reservas"."descuento_cop" >= 0);