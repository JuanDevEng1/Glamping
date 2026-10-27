"use server";

// Server actions de servicios. Solo delegan en el backend, que valida con Zod y recalcula
// precios y cupos: del navegador solo llegan ids, fechas, turnos y cantidades.
import {
  crearPedidoPendiente,
  liberarPedidoPendiente,
  obtenerServicio,
  validarCarrito,
  vincularReserva,
} from "@lauburu/backend/pedidos";
import { capturarPagoPaypal, iniciarPagoPaypal } from "@lauburu/backend/pagos";

type Item = { servicioId: number; fecha: string | null; turno: string | null; cantidad: number };
type Vinculo = { codigo: string; correo: string } | null;

export async function validarCarritoAccion(items: Item[], reserva: Vinculo) {
  return validarCarrito({ items, reserva: reserva ?? undefined });
}

export async function vincularReservaAccion(codigo: string, correo: string) {
  return vincularReserva({ codigo, correo });
}

/** Fechas con cupos dentro de la estadía vinculada (verifica código y correo). */
export async function fechasEnEstadiaAccion(
  slug: string,
  reserva: { codigo: string; correo: string },
) {
  const estadia = await vincularReserva(reserva);
  if (!estadia) return null;
  const servicio = await obtenerServicio(slug, estadia);
  return servicio ? { fechas: servicio.fechas, unidadesLibres: servicio.unidadesLibres } : null;
}

export async function crearPedidoAccion(
  items: Item[],
  comprador: Record<string, unknown>,
  reserva: Vinculo,
) {
  return crearPedidoPendiente({ items, comprador, reserva: reserva ?? undefined });
}

export async function liberarPedidoAccion(codigo: string) {
  await liberarPedidoPendiente(String(codigo));
}

export async function iniciarPagoPedido(codigo: string) {
  return iniciarPagoPaypal({ tipo: "pedido", codigo });
}

export async function capturarPagoPedido(idOrden: string) {
  return capturarPagoPaypal(idOrden);
}
