"use server";

// Server actions de servicios. Solo delegan en el backend, que valida con Zod y recalcula
// precios y cupos: del navegador solo llegan ids, fechas, turnos y cantidades.
// Cada acción tiene límite por IP.
import { DEMASIADAS_PETICIONES } from "@lauburu/backend/db";
import {
  crearPedidoPendiente,
  liberarPedidoPendiente,
  obtenerServicio,
  validarCarrito,
  vincularReserva,
  type ValidacionCarrito,
} from "@lauburu/backend/pedidos";
import { capturarPagoPaypal, iniciarPagoPaypal } from "@lauburu/backend/pagos";
import { dentroDelLimite } from "@/lib/limites";

type Item = { servicioId: number; fecha: string | null; turno: string | null; cantidad: number };
type Vinculo = { codigo: string; correo: string } | null;

export async function validarCarritoAccion(
  items: Item[],
  reserva: Vinculo,
): Promise<ValidacionCarrito> {
  if (!(await dentroDelLimite("carrito", "consulta"))) {
    return { lineas: [], total: 0, valido: false, reserva: null, error: "demasiadas_peticiones" };
  }
  return validarCarrito({ items, reserva: reserva ?? undefined });
}

export async function vincularReservaAccion(codigo: string, correo: string) {
  if (!(await dentroDelLimite("vincular", "vincular"))) return DEMASIADAS_PETICIONES;
  return vincularReserva({ codigo, correo });
}

/** Fechas con cupos dentro de la estadía vinculada (verifica código y correo). */
export async function fechasEnEstadiaAccion(
  slug: string,
  reserva: { codigo: string; correo: string },
) {
  if (!(await dentroDelLimite("fechas-estadia", "consulta"))) return DEMASIADAS_PETICIONES;
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
  if (!(await dentroDelLimite("crear-pedido", "crear"))) return DEMASIADAS_PETICIONES;
  return crearPedidoPendiente({ items, comprador, reserva: reserva ?? undefined });
}

export async function liberarPedidoAccion(codigo: string) {
  await liberarPedidoPendiente(String(codigo));
}

export async function iniciarPagoPedido(codigo: string) {
  if (!(await dentroDelLimite("iniciar-pago", "pago"))) return DEMASIADAS_PETICIONES;
  return iniciarPagoPaypal({ tipo: "pedido", codigo });
}

export async function capturarPagoPedido(idOrden: string) {
  if (!(await dentroDelLimite("capturar-pago", "pago"))) return DEMASIADAS_PETICIONES;
  return capturarPagoPaypal(idOrden);
}
