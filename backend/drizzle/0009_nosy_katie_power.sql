ALTER TABLE "pagos" DROP CONSTRAINT "pagos_estado";--> statement-breakpoint
ALTER TABLE "configuracion" ADD COLUMN "monto_deposito" integer DEFAULT 100000 NOT NULL;--> statement-breakpoint
ALTER TABLE "pagos" ADD COLUMN "concepto" text DEFAULT 'cobro' NOT NULL;--> statement-breakpoint
ALTER TABLE "pagos" ADD COLUMN "id_autorizacion" text;--> statement-breakpoint
ALTER TABLE "pagos" ADD COLUMN "autorizacion_vence_en" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "pagos_deposito_vigente" ON "pagos" USING btree ("reserva_id") WHERE "pagos"."concepto" = 'deposito' and "pagos"."estado" in ('creado', 'autorizado');--> statement-breakpoint
ALTER TABLE "configuracion" ADD CONSTRAINT "configuracion_deposito" CHECK ("configuracion"."monto_deposito" >= 0);--> statement-breakpoint
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_concepto" CHECK ("pagos"."concepto" in ('cobro', 'deposito'));--> statement-breakpoint
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_deposito_reserva" CHECK ("pagos"."concepto" = 'cobro' or "pagos"."reserva_id" is not null);--> statement-breakpoint
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_estado" CHECK ("pagos"."estado" in ('creado', 'capturado', 'aprobado', 'rechazado', 'reembolsado', 'requiere_reembolso', 'autorizado', 'cobrado', 'anulado'));