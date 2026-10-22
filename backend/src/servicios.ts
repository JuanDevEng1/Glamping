// Reglas del carrito de servicios (PLAN_DESARROLLO.md, Fase 5). Funciones puras, sin BD.
// El precio y la disponibilidad salen siempre del catálogo del servidor, nunca del navegador.
import { esFechaValida } from "./precios";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export const CATEGORIAS = {
  tours: "Tours",
  fincas: "Planes en fincas",
  gastronomia: "Gastronomía",
  decoracion: "Decoración",
  transporte: "Transporte",
} as const;

export type Categoria = keyof typeof CATEGORIAS;

export const UNIDADES_PRECIO = {
  persona: "por persona",
  pareja: "por pareja",
  trayecto: "por trayecto",
  unidad: "por unidad",
} as const;

export type UnidadPrecio = keyof typeof UNIDADES_PRECIO;

/** Lo mínimo del catálogo que necesita la validación del carrito. */
export type ServicioCatalogo = {
  id: number;
  slug: string;
  nombre: string;
  precio: number;
  unidadPrecio: UnidadPrecio;
  tipoStock: "cupos" | "unidades";
  stock: number | null;
  maxPorPedido: number;
  incluidoOExtra: "incluido" | "extra";
  activo: boolean;
  turnos: string[];
};

export type ItemCarrito = {
  servicioId: number;
  fecha: string | null;
  turno: string | null;
  cantidad: number;
};

/** Cupos/unidades libres en este momento (capacidad − confirmados − apartados por pedidos pendientes). */
export type Disponibilidad = {
  cupos: Map<string, number>;
  unidades: Map<number, number>;
};

export type EstadoLinea =
  | "ok"
  | "no_existe"
  | "inactivo"
  | "incluido"
  | "cantidad_invalida"
  | "fecha_invalida"
  | "turno_invalido"
  | "fuera_de_estadia"
  | "agotado"
  | "sin_cupos_suficientes";

export type LineaCarrito = {
  servicioId: number;
  nombre: string;
  fecha: string | null;
  turno: string | null;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
  estado: EstadoLinea;
  /** Con sin_cupos_suficientes: cuántos quedan para esta línea. */
  disponible?: number;
};

export type ResultadoCarrito = { lineas: LineaCarrito[]; total: number; valido: boolean };

export type OpcionesCarrito = {
  hoy: string;
  /** Reserva vinculada: los servicios deben caer entre la llegada y la salida (inclusive). */
  estadia: { llegada: string; salida: string } | null;
};

// ---------------------------------------------------------------------------
// Reglas
// ---------------------------------------------------------------------------

export function claveCupo(servicioId: number, fecha: string, turno: string | null) {
  return `${servicioId}|${fecha}|${turno ?? ""}`;
}

export function cotizarCarrito(
  items: ItemCarrito[],
  catalogo: Map<number, ServicioCatalogo>,
  disponibilidad: Disponibilidad,
  { hoy, estadia }: OpcionesCarrito,
): ResultadoCarrito {
  // Lo ya pedido por líneas anteriores del mismo cupo o servicio.
  const usados = new Map<string, number>();

  const lineas = items.map((item): LineaCarrito => {
    const servicio = catalogo.get(item.servicioId);
    const turnoValido = servicio && servicio.turnos.length > 0 ? item.turno : null;
    const base: LineaCarrito = {
      servicioId: item.servicioId,
      nombre: servicio?.nombre ?? "",
      fecha: item.fecha,
      turno: turnoValido,
      cantidad: item.cantidad,
      precioUnitario: servicio?.precio ?? 0,
      subtotal: 0,
      estado: "ok",
    };
    const error = (estado: EstadoLinea, extra: Partial<LineaCarrito> = {}) => ({
      ...base,
      estado,
      ...extra,
    });

    if (!servicio) return error("no_existe");
    if (!servicio.activo) return error("inactivo");
    if (servicio.incluidoOExtra === "incluido") return error("incluido");
    if (
      !Number.isInteger(item.cantidad) ||
      item.cantidad < 1 ||
      item.cantidad > servicio.maxPorPedido
    ) {
      return error("cantidad_invalida");
    }

    const { fecha } = item;
    const requiereFecha = servicio.tipoStock === "cupos";
    if (fecha === null ? requiereFecha : !esFechaValida(fecha) || fecha < hoy)
      return error("fecha_invalida");
    if (fecha && estadia && (fecha < estadia.llegada || fecha > estadia.salida))
      return error("fuera_de_estadia");

    if (servicio.turnos.length > 0 && (!item.turno || !servicio.turnos.includes(item.turno))) {
      return error("turno_invalido");
    }

    const clave =
      servicio.tipoStock === "cupos"
        ? claveCupo(servicio.id, fecha!, turnoValido)
        : `u|${servicio.id}`;
    const libres =
      servicio.tipoStock === "cupos"
        ? (disponibilidad.cupos.get(clave) ?? 0)
        : (disponibilidad.unidades.get(servicio.id) ?? 0);
    const restantes = libres - (usados.get(clave) ?? 0);

    if (restantes <= 0) return error("agotado");
    if (item.cantidad > restantes) return error("sin_cupos_suficientes", { disponible: restantes });

    usados.set(clave, (usados.get(clave) ?? 0) + item.cantidad);
    return { ...base, subtotal: servicio.precio * item.cantidad };
  });

  const total = lineas.reduce((s, l) => s + (l.estado === "ok" ? l.subtotal : 0), 0);
  return { lineas, total, valido: lineas.length > 0 && lineas.every((l) => l.estado === "ok") };
}
