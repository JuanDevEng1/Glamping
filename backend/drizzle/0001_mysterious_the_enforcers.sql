CREATE TABLE "ajustes_fecha" (
	"fecha" date PRIMARY KEY NOT NULL,
	"precio" integer,
	"bloqueada" boolean DEFAULT false NOT NULL,
	"motivo" text
);
--> statement-breakpoint
CREATE TABLE "festivos" (
	"fecha" date PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reservas" (
	"id" serial PRIMARY KEY NOT NULL,
	"codigo" text NOT NULL,
	"fecha_llegada" date NOT NULL,
	"fecha_salida" date NOT NULL,
	"huespedes" integer NOT NULL,
	"estado" text DEFAULT 'pendiente' NOT NULL,
	"total_cop" integer NOT NULL,
	"desglose" jsonb NOT NULL,
	"nombre" text NOT NULL,
	"correo" text NOT NULL,
	"telefono" text NOT NULL,
	"tipo_documento" text NOT NULL,
	"documento" text NOT NULL,
	"pais" text NOT NULL,
	"ciudad" text,
	"comentarios" text,
	"pasarela" text,
	"expira_en" timestamp with time zone NOT NULL,
	"terminos_version" text NOT NULL,
	"acepta_marketing" boolean DEFAULT false NOT NULL,
	"creada_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservas_codigo_unique" UNIQUE("codigo"),
	CONSTRAINT "reservas_fechas" CHECK ("reservas"."fecha_salida" > "reservas"."fecha_llegada"),
	CONSTRAINT "reservas_huespedes" CHECK ("reservas"."huespedes" between 1 and 6),
	CONSTRAINT "reservas_estado" CHECK ("reservas"."estado" in ('pendiente', 'confirmada', 'cancelada', 'expirada'))
);
--> statement-breakpoint
CREATE TABLE "temporadas" (
	"id" serial PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"fecha_inicio" date NOT NULL,
	"fecha_fin" date NOT NULL,
	"precio_noche" integer NOT NULL,
	"precio_persona_extra" integer,
	"minimo_noches" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "temporadas_rango" CHECK ("temporadas"."fecha_fin" >= "temporadas"."fecha_inicio"),
	CONSTRAINT "temporadas_precio" CHECK ("temporadas"."precio_noche" > 0)
);
--> statement-breakpoint
ALTER TABLE "configuracion" ADD COLUMN "minutos_hold" integer DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE "configuracion" ADD COLUMN "noche_festivo_alta" boolean DEFAULT false NOT NULL;