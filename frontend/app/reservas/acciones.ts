"use server";

// Server actions del flujo de reserva. Solo delegan en el backend, que valida con Zod y
// recalcula el precio: el navegador nunca envía montos.
import {
  cotizarEstadia,
  crearReservaPendiente,
  liberarReservaPendiente,
} from "@lauburu/backend/reservas";

type Estadia = { llegada: string; salida: string; huespedes: number };

export async function cotizar(estadia: Estadia) {
  return cotizarEstadia(estadia);
}

export async function crearReserva(estadia: Estadia, huesped: Record<string, unknown>) {
  return crearReservaPendiente({ estadia, huesped });
}

export async function liberarReserva(codigo: string) {
  await liberarReservaPendiente(String(codigo));
}
