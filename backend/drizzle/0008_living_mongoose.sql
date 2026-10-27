CREATE TABLE "limites_peticiones" (
	"clave" text PRIMARY KEY NOT NULL,
	"inicio" timestamp with time zone DEFAULT now() NOT NULL,
	"conteo" integer NOT NULL
);
