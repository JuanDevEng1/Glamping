"use server";

// Server actions del flujo de reserva. Solo delegan en el backend, que valida con Zod y
// recalcula el precio: el navegador nunca envía montos.
import {
  cotizarEstadia,
  crearReservaPendiente,
  obtenerCabalgata,
  liberarReservaPendiente,
  recibirDocumentoReserva,
} from "@lauburu/backend/reservas";
import { capturarPagoPaypal, iniciarPagoPaypal } from "@lauburu/backend/pagos";

type Estadia = {
  llegada: string;
  salida: string;
  huespedes: number;
  adicionales?: { adultos: number; ninos: number; menores: number };
  /** Código de descuento: el servidor lo valida y calcula el descuento. */
  codigo?: string;
  /** Cabalgata para todo el grupo: el servidor valida el cupo y pone el precio. */
  cabalgata?: { fecha: string; turno: string };
};

export async function cotizar(estadia: Estadia) {
  return cotizarEstadia(estadia);
}

export async function cabalgataDeEstadia(estadia: Estadia) {
  return obtenerCabalgata(estadia);
}

export async function crearReserva(estadia: Estadia, huesped: Record<string, unknown>) {
  return crearReservaPendiente({ estadia, huesped });
}

export async function liberarReserva(codigo: string) {
  await liberarReservaPendiente(String(codigo));
}

export async function iniciarPagoReserva(codigo: string) {
  return iniciarPagoPaypal({ tipo: "reserva", codigo });
}

export async function capturarPagoReserva(idOrden: string) {
  return capturarPagoPaypal(idOrden);
}

export async function subirDocumento(codigo: string, datos: FormData) {
  return recibirDocumentoReserva(codigo, datos.get("documento"));
}
