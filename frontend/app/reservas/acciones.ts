"use server";

// Server actions del flujo de reserva. Solo delegan en el backend, que valida con Zod y
// recalcula el precio: el navegador nunca envía montos. Cada acción tiene límite por IP.
import { after } from "next/server";
import { DEMASIADAS_PETICIONES } from "@lauburu/backend/db";
import {
  cotizarEstadia,
  crearReservaPendiente,
  liberarReservaPendiente,
  recibirDocumentoReserva,
} from "@lauburu/backend/reservas";
import {
  autorizarDepositoPaypal,
  capturarPagoPaypal,
  iniciarDepositoOpenpay,
  iniciarDepositoPaypal,
  iniciarPagoPaypal,
  iniciarPseOpenpay,
  liberarDepositosHuerfanos,
  pagarConTarjetaOpenpay,
} from "@lauburu/backend/pagos";
import { dentroDelLimite, urlSitio } from "@/lib/limites";

type Estadia = {
  llegada: string;
  salida: string;
  huespedes: number;
  adicionales?: { adultos: number; ninos: number; menores: number };
  mascotas?: number;
};

export async function cotizar(estadia: Estadia) {
  if (!(await dentroDelLimite("cotizar", "consulta"))) return DEMASIADAS_PETICIONES;
  return cotizarEstadia(estadia);
}

export async function crearReserva(estadia: Estadia, huesped: Record<string, unknown>) {
  if (!(await dentroDelLimite("crear-reserva", "crear"))) return DEMASIADAS_PETICIONES;
  // Sin tareas programadas: aprovecha para liberar depósitos de reservas que no se pagaron,
  // después de responder para no demorar al huésped.
  after(() =>
    liberarDepositosHuerfanos().catch(() =>
      console.error("No se pudieron liberar depósitos al crear una reserva"),
    ),
  );
  return crearReservaPendiente({ estadia, huesped });
}

export async function liberarReserva(codigo: string) {
  await liberarReservaPendiente(String(codigo));
}

export async function iniciarPagoReserva(codigo: string) {
  if (!(await dentroDelLimite("iniciar-pago", "pago"))) return DEMASIADAS_PETICIONES;
  return iniciarPagoPaypal({ tipo: "reserva", codigo });
}

export async function capturarPagoReserva(idOrden: string) {
  if (!(await dentroDelLimite("capturar-pago", "pago"))) return DEMASIADAS_PETICIONES;
  return capturarPagoPaypal(idOrden);
}

/**
 * Depósito de garantía, en el paso de pago y antes del cobro: el monto sale de la BD; aquí
 * solo viaja el código de la reserva.
 */
export async function iniciarDepositoReserva(codigo: string) {
  if (!(await dentroDelLimite("iniciar-deposito", "pago"))) return DEMASIADAS_PETICIONES;
  return iniciarDepositoPaypal({ codigo });
}

export async function autorizarDepositoReserva(idOrden: string) {
  if (!(await dentroDelLimite("autorizar-deposito", "pago"))) return DEMASIADAS_PETICIONES;
  return autorizarDepositoPaypal(idOrden);
}

/** Openpay: del navegador solo llegan el token de la tarjeta y el id antifraude. */
export async function pagarTarjetaReserva(codigo: string, token: string, deviceSessionId: string) {
  if (!(await dentroDelLimite("pagar-tarjeta", "pago"))) return DEMASIADAS_PETICIONES;
  return pagarConTarjetaOpenpay({ destino: { tipo: "reserva", codigo }, token, deviceSessionId });
}

export async function iniciarPseReserva(codigo: string) {
  if (!(await dentroDelLimite("iniciar-pse", "pago"))) return DEMASIADAS_PETICIONES;
  return iniciarPseOpenpay({
    destino: { tipo: "reserva", codigo },
    urlRetorno: `${await urlSitio()}/reservas/confirmacion/${encodeURIComponent(codigo)}`,
  });
}

export async function depositoTarjetaReserva(
  codigo: string,
  token: string,
  deviceSessionId: string,
) {
  if (!(await dentroDelLimite("deposito-tarjeta", "pago"))) return DEMASIADAS_PETICIONES;
  return iniciarDepositoOpenpay({ codigo, token, deviceSessionId });
}

export async function subirDocumento(codigo: string, datos: FormData) {
  if (!(await dentroDelLimite("documento", "documento"))) return DEMASIADAS_PETICIONES;
  return recibirDocumentoReserva(codigo, datos.get("documento"));
}
