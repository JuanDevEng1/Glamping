CREATE TABLE "configuracion" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"precio_base" integer NOT NULL,
	"precio_alto" integer NOT NULL,
	"precio_persona_extra" integer NOT NULL,
	"max_huespedes" integer DEFAULT 6 NOT NULL,
	"huespedes_incluidos" integer DEFAULT 2 NOT NULL,
	"hora_checkin" time DEFAULT '15:00' NOT NULL,
	"hora_checkout" time DEFAULT '12:00' NOT NULL,
	"minimo_noches_puente" integer DEFAULT 1 NOT NULL,
	"version_terminos" text DEFAULT '1' NOT NULL,
	CONSTRAINT "configuracion_fila_unica" CHECK ("configuracion"."id" = 1),
	CONSTRAINT "configuracion_montos_positivos" CHECK ("configuracion"."precio_base" > 0 and "configuracion"."precio_alto" > 0 and "configuracion"."precio_persona_extra" >= 0)
);
