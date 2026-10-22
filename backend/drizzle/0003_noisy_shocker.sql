CREATE TABLE "aliados" (
	"id" serial PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"correo" text NOT NULL,
	"telefono" text
);
--> statement-breakpoint
CREATE TABLE "cupos_servicio" (
	"id" serial PRIMARY KEY NOT NULL,
	"servicio_id" integer NOT NULL,
	"fecha" date NOT NULL,
	"turno" text DEFAULT '' NOT NULL,
	"capacidad" integer NOT NULL,
	"reservados" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "cupos_servicio_unico" UNIQUE("servicio_id","fecha","turno"),
	CONSTRAINT "cupos_servicio_rango" CHECK ("cupos_servicio"."reservados" >= 0 and "cupos_servicio"."reservados" <= "cupos_servicio"."capacidad")
);
--> statement-breakpoint
CREATE TABLE "items_pedido" (
	"id" serial PRIMARY KEY NOT NULL,
	"pedido_id" integer NOT NULL,
	"servicio_id" integer NOT NULL,
	"fecha" date,
	"turno" text,
	"cantidad" integer NOT NULL,
	"precio_unitario" integer NOT NULL,
	"subtotal" integer NOT NULL,
	CONSTRAINT "items_pedido_cantidad" CHECK ("items_pedido"."cantidad" >= 1)
);
--> statement-breakpoint
CREATE TABLE "pedidos" (
	"id" serial PRIMARY KEY NOT NULL,
	"codigo" text NOT NULL,
	"reserva_id" integer,
	"estado" text DEFAULT 'pendiente' NOT NULL,
	"total_cop" integer NOT NULL,
	"nombre" text NOT NULL,
	"correo" text NOT NULL,
	"telefono" text NOT NULL,
	"comentarios" text,
	"expira_en" timestamp with time zone NOT NULL,
	"terminos_version" text NOT NULL,
	"acepta_marketing" boolean DEFAULT false NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pedidos_codigo_unique" UNIQUE("codigo"),
	CONSTRAINT "pedidos_estado" CHECK ("pedidos"."estado" in ('pendiente', 'confirmado', 'cancelado', 'expirado'))
);
--> statement-breakpoint
CREATE TABLE "servicios" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"aliado_id" integer NOT NULL,
	"nombre" text NOT NULL,
	"categoria" text NOT NULL,
	"resumen" text NOT NULL,
	"descripcion" text NOT NULL,
	"precio" integer NOT NULL,
	"unidad_precio" text NOT NULL,
	"tipo_stock" text NOT NULL,
	"stock" integer,
	"max_por_pedido" integer DEFAULT 4 NOT NULL,
	"incluido_o_extra" text DEFAULT 'extra' NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"orden" integer DEFAULT 0 NOT NULL,
	"duracion" text,
	"nivel" text,
	"punto_encuentro" text,
	"turnos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"incluye" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"no_incluye" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"condiciones" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fotos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "servicios_slug_unique" UNIQUE("slug"),
	CONSTRAINT "servicios_precio" CHECK ("servicios"."precio" >= 0),
	CONSTRAINT "servicios_stock" CHECK ("servicios"."stock" is null or "servicios"."stock" >= 0),
	CONSTRAINT "servicios_max" CHECK ("servicios"."max_por_pedido" >= 1)
);
--> statement-breakpoint
ALTER TABLE "cupos_servicio" ADD CONSTRAINT "cupos_servicio_servicio_id_servicios_id_fk" FOREIGN KEY ("servicio_id") REFERENCES "public"."servicios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items_pedido" ADD CONSTRAINT "items_pedido_pedido_id_pedidos_id_fk" FOREIGN KEY ("pedido_id") REFERENCES "public"."pedidos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items_pedido" ADD CONSTRAINT "items_pedido_servicio_id_servicios_id_fk" FOREIGN KEY ("servicio_id") REFERENCES "public"."servicios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_reserva_id_reservas_id_fk" FOREIGN KEY ("reserva_id") REFERENCES "public"."reservas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "servicios" ADD CONSTRAINT "servicios_aliado_id_aliados_id_fk" FOREIGN KEY ("aliado_id") REFERENCES "public"."aliados"("id") ON DELETE no action ON UPDATE no action;