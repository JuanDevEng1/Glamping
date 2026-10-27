CREATE TABLE "eventos_pasarela" (
	"id" serial PRIMARY KEY NOT NULL,
	"pasarela" text NOT NULL,
	"id_evento" text NOT NULL,
	"tipo" text NOT NULL,
	"payload" jsonb NOT NULL,
	"recibido_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eventos_pasarela_unico" UNIQUE("pasarela","id_evento")
);
--> statement-breakpoint
CREATE TABLE "pagos" (
	"id" serial PRIMARY KEY NOT NULL,
	"pasarela" text NOT NULL,
	"reserva_id" integer,
	"pedido_id" integer,
	"id_externo" text NOT NULL,
	"id_captura" text,
	"estado" text DEFAULT 'creado' NOT NULL,
	"monto_cop" integer NOT NULL,
	"moneda" text NOT NULL,
	"monto_moneda" integer NOT NULL,
	"trm" numeric(12, 2),
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pagos_id_externo" UNIQUE("pasarela","id_externo"),
	CONSTRAINT "pagos_destino" CHECK (("pagos"."reserva_id" is null) <> ("pagos"."pedido_id" is null)),
	CONSTRAINT "pagos_estado" CHECK ("pagos"."estado" in ('creado', 'capturado', 'aprobado', 'rechazado', 'reembolsado', 'requiere_reembolso')),
	CONSTRAINT "pagos_montos" CHECK ("pagos"."monto_cop" > 0 and "pagos"."monto_moneda" > 0)
);
--> statement-breakpoint
ALTER TABLE "configuracion" ADD COLUMN "trm_valor" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "configuracion" ADD COLUMN "trm_fecha" date;--> statement-breakpoint
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_reserva_id_reservas_id_fk" FOREIGN KEY ("reserva_id") REFERENCES "public"."reservas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_pedido_id_pedidos_id_fk" FOREIGN KEY ("pedido_id") REFERENCES "public"."pedidos"("id") ON DELETE no action ON UPDATE no action;