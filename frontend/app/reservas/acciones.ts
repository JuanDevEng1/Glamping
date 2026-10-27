"use server";

// Server actions del flujo de reserva. Solo delegan en el backend, que valida con Zod y
// recalcula el precio: el navegador nunca envía montos. Cada acción tiene límite por IP.
import { DEMASIADAS_PETICIONES } from "@lauburu/backend/db";
import {
  cotizarEstadia,
  crearReservaPendiente,
  liberarReservaPendiente,
  recibirDocumentoReserva,
} from "@lauburu/backend/reservas";
import { capturarPagoPaypal, iniciarPagoPaypal } from "@lauburu/backend/pagos";
import { dentroDelLimite } from "@/lib/limites";

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

export async function subirDocumento(codigo: string, datos: FormData) {
  if (!(await dentroDelLimite("documento", "documento"))) return DEMASIADAS_PETICIONES;
  return recibirDocumentoReserva(codigo, datos.get("documento"));
}
