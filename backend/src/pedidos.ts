// Catálogo de servicios, disponibilidad y pedidos (Fase 5). Usa la BD; las reglas
// del carrito están en servicios.ts. El stock se descuenta SOLO al confirmar el pago
// (webhook, tarea de pasarelas); un pedido pendiente aparta cupos hasta expira_en.
import { and, asc, eq, gt, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { z } from "zod";
import {
  aliados,
  configuracion,
  cuposServicio,
  getDb,
  itemsPedido,
  pedidos,
  reservas,
  servicios,
  type Db,
  type Tx,
} from "./db";
import { hoyEnBogota } from "./moneda";
import { sumarDias } from "./precios";
import { enmascararCorreo, esquemaHuesped, nuevoCodigo } from "./reservas";
import {
  claveCupo,
  cotizarCarrito,
  type Categoria,
  type Disponibilidad,
  type ResultadoCarrito,
  type ServicioCatalogo,
} from "./servicios";

/** Días hacia adelante en los que se ofrecen fechas sin reserva vinculada. */
export const DIAS_VENTA = 60;

const hayBd = () => !!process.env.DATABASE_URL;

// ---------------------------------------------------------------------------
// Disponibilidad
// ---------------------------------------------------------------------------

/**
 * Cupos y unidades libres = capacidad − pagados − apartados por pedidos pendientes vigentes.
 * Con `bloquear`, toma FOR UPDATE las filas de cupos y servicios: dos pedidos simultáneos
 * sobre el mismo cupo se ejecutan uno detrás del otro.
 */
async function cargarDisponibilidad(
  ej: Db | Tx,
  servicioIds: number[],
  rango: { desde: string; hasta: string } | null,
  bloquear = false,
): Promise<Disponibilidad> {
  const disponibilidad: Disponibilidad = { cupos: new Map(), unidades: new Map() };
  if (servicioIds.length === 0) return disponibilidad;

  const filtroCupos = and(
    inArray(cuposServicio.servicioId, servicioIds),
    rango
      ? and(gte(cuposServicio.fecha, rango.desde), lte(cuposServicio.fecha, rango.hasta))
      : undefined,
  );
  const consultaCupos = ej.select().from(cuposServicio).where(filtroCupos);
  const consultaUnidades = ej
    .select({ id: servicios.id, stock: servicios.stock })
    .from(servicios)
    .where(and(inArray(servicios.id, servicioIds), eq(servicios.tipoStock, "unidades")));

  const filasCupos = bloquear ? await consultaCupos.for("update") : await consultaCupos;
  const filasUnidades = bloquear ? await consultaUnidades.for("update") : await consultaUnidades;

  const apartados = await ej
    .select({
      servicioId: itemsPedido.servicioId,
      fecha: itemsPedido.fecha,
      turno: itemsPedido.turno,
      cantidad: sql<number>`sum(${itemsPedido.cantidad})::int`,
    })
    .from(itemsPedido)
    .innerJoin(pedidos, eq(pedidos.id, itemsPedido.pedidoId))
    .where(
      and(
        inArray(itemsPedido.servicioId, servicioIds),
        eq(pedidos.estado, "pendiente"),
        gt(pedidos.expiraEn, sql`now()`),
      ),
    )
    .groupBy(itemsPedido.servicioId, itemsPedido.fecha, itemsPedido.turno);

  const apartadoCupo = new Map<string, number>();
  const apartadoUnidad = new Map<number, number>();
  for (const a of apartados) {
    if (a.fecha) {
      const k = claveCupo(a.servicioId, a.fecha, a.turno);
      apartadoCupo.set(k, (apartadoCupo.get(k) ?? 0) + a.cantidad);
    }
    apartadoUnidad.set(a.servicioId, (apartadoUnidad.get(a.servicioId) ?? 0) + a.cantidad);
  }

  for (const c of filasCupos) {
    const k = claveCupo(c.servicioId, c.fecha, c.turno || null);
    disponibilidad.cupos.set(
      k,
      Math.max(0, c.capacidad - c.reservados - (apartadoCupo.get(k) ?? 0)),
    );
  }
  for (const u of filasUnidades) {
    disponibilidad.unidades.set(
      u.id,
      Math.max(0, (u.stock ?? 0) - (apartadoUnidad.get(u.id) ?? 0)),
    );
  }
  return disponibilidad;
}

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------

export type ServicioResumen = {
  id: number;
  slug: string;
  nombre: string;
  categoria: Categoria;
  resumen: string;
  precio: number;
  unidadPrecio: ServicioCatalogo["unidadPrecio"];
  incluidoOExtra: ServicioCatalogo["incluidoOExtra"];
  duracion: string | null;
  aliado: string;
  foto: string;
  /** Hay al menos un cupo o unidad libre en los próximos DIAS_VENTA días. */
  disponible: boolean;
};

const columnasResumen = {
  id: servicios.id,
  slug: servicios.slug,
  nombre: servicios.nombre,
  categoria: servicios.categoria,
  resumen: servicios.resumen,
  precio: servicios.precio,
  unidadPrecio: servicios.unidadPrecio,
  incluidoOExtra: servicios.incluidoOExtra,
  tipoStock: servicios.tipoStock,
  duracion: servicios.duracion,
  fotos: servicios.fotos,
  aliado: aliados.nombre,
};

async function resumir(
  filas: (Omit<ServicioResumen, "foto" | "disponible"> & { tipoStock: string; fotos: string[] })[],
) {
  const hoy = hoyEnBogota();
  const disp = await cargarDisponibilidad(
    getDb(),
    filas.map((f) => f.id),
    { desde: hoy, hasta: sumarDias(hoy, DIAS_VENTA) },
  );
  const conCupos = new Set<number>();
  for (const [clave, libres] of disp.cupos)
    if (libres > 0) conCupos.add(Number(clave.split("|")[0]));

  return filas.map(({ tipoStock, fotos, ...f }): ServicioResumen => ({
    ...f,
    foto: fotos[0] ?? f.nombre,
    disponible:
      f.incluidoOExtra === "incluido" ||
      (tipoStock === "cupos" ? conCupos.has(f.id) : (disp.unidades.get(f.id) ?? 0) > 0),
  }));
}

/** Servicios activos, opcionalmente de una categoría. Sin BD devuelve []. */
export async function listarServicios(categoria?: Categoria): Promise<ServicioResumen[]> {
  if (!hayBd()) return [];
  const filas = await getDb()
    .select(columnasResumen)
    .from(servicios)
    .innerJoin(aliados, eq(aliados.id, servicios.aliadoId))
    .where(
      and(eq(servicios.activo, true), categoria ? eq(servicios.categoria, categoria) : undefined),
    )
    .orderBy(asc(servicios.orden), asc(servicios.nombre));
  return resumir(filas);
}

/** Cantidad de servicios activos por categoría (para los filtros). */
export async function contarPorCategoria(): Promise<Partial<Record<Categoria, number>>> {
  if (!hayBd()) return {};
  const filas = await getDb()
    .select({ categoria: servicios.categoria, total: sql<number>`count(*)::int` })
    .from(servicios)
    .where(eq(servicios.activo, true))
    .groupBy(servicios.categoria);
  return Object.fromEntries(filas.map((f) => [f.categoria, f.total]));
}

export type EstadiaVinculada = {
  codigo: string;
  llegada: string;
  salida: string;
  huespedes: number;
  nombre: string;
};

export type FechaDisponible = { fecha: string; turnos: { turno: string | null; libres: number }[] };

export type ServicioDetalle = Omit<ServicioResumen, "foto" | "disponible"> & {
  descripcion: string;
  tipoStock: ServicioCatalogo["tipoStock"];
  maxPorPedido: number;
  nivel: string | null;
  puntoEncuentro: string | null;
  turnos: string[];
  incluye: string[];
  noIncluye: string[];
  condiciones: { titulo: string; texto: string }[];
  fotos: string[];
  /** Fechas con cupos libres (servicios por cupos), dentro de la estadía si hay una vinculada. */
  fechas: FechaDisponible[];
  /** Unidades libres (servicios por unidades). */
  unidadesLibres: number | null;
};

export async function obtenerServicio(
  slug: string,
  estadia: { llegada: string; salida: string } | null = null,
): Promise<ServicioDetalle | null> {
  if (!hayBd() || !/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  const [s] = await getDb()
    .select({ servicio: servicios, aliado: aliados.nombre })
    .from(servicios)
    .innerJoin(aliados, eq(aliados.id, servicios.aliadoId))
    .where(and(eq(servicios.slug, slug), eq(servicios.activo, true)))
    .limit(1);
  if (!s) return null;

  const hoy = hoyEnBogota();
  const desde = estadia && estadia.llegada > hoy ? estadia.llegada : hoy;
  const hasta = estadia ? estadia.salida : sumarDias(hoy, DIAS_VENTA);
  const disp = await cargarDisponibilidad(getDb(), [s.servicio.id], { desde, hasta });

  const porFecha = new Map<string, FechaDisponible>();
  for (const [clave, libres] of disp.cupos) {
    const [, fecha = "", turno = ""] = clave.split("|");
    if (libres <= 0 || fecha < desde || fecha > hasta) continue;
    if (s.servicio.turnos.length > 0 && !s.servicio.turnos.includes(turno)) continue;
    const dia = porFecha.get(fecha) ?? { fecha, turnos: [] };
    dia.turnos.push({ turno: turno || null, libres });
    porFecha.set(fecha, dia);
  }
  const fechas = [...porFecha.values()]
    .sort((a, b) => a.fecha.localeCompare(b.fecha))
    .map((d) => ({
      ...d,
      turnos: d.turnos.sort((a, b) => (a.turno ?? "").localeCompare(b.turno ?? "")),
    }));

  const { aliadoId: _a, activo: _b, orden: _c, stock: _d, ...servicio } = s.servicio;
  return {
    ...servicio,
    aliado: s.aliado,
    fechas: servicio.tipoStock === "cupos" ? fechas : [],
    unidadesLibres:
      servicio.tipoStock === "unidades" ? (disp.unidades.get(servicio.id) ?? 0) : null,
  };
}

// ---------------------------------------------------------------------------
// Reserva vinculada
// ---------------------------------------------------------------------------

const esquemaVinculo = z.object({
  codigo: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^LAU-[A-Z0-9]{8}$/),
  correo: z.email().trim().toLowerCase(),
});

/** Devuelve la estadía si el código y el correo coinciden con una reserva confirmada. */
export async function vincularReserva(entrada: unknown): Promise<EstadiaVinculada | null> {
  const datos = esquemaVinculo.safeParse(entrada);
  if (!datos.success || !hayBd()) return null;
  const [r] = await getDb()
    .select()
    .from(reservas)
    .where(
      and(
        eq(reservas.codigo, datos.data.codigo),
        eq(sql`lower(${reservas.correo})`, datos.data.correo),
        eq(reservas.estado, "confirmada"),
      ),
    )
    .limit(1);
  if (!r) return null;
  return {
    codigo: r.codigo,
    llegada: r.fechaLlegada,
    salida: r.fechaSalida,
    huespedes: r.huespedes,
    nombre: r.nombre.split(" ")[0] ?? r.nombre,
  };
}

// ---------------------------------------------------------------------------
// Carrito y pedidos
// ---------------------------------------------------------------------------

const esquemaItems = z
  .array(
    z.object({
      servicioId: z.number().int().positive(),
      fecha: z.string().max(10).nullable(),
      turno: z.string().max(10).nullable(),
      cantidad: z.number(),
    }),
  )
  .max(20);

export const esquemaComprador = esquemaHuesped.pick({
  nombre: true,
  correo: true,
  telefono: true,
  comentarios: true,
  aceptaTerminos: true,
  aceptaMarketing: true,
});

async function catalogoDe(ej: Db | Tx, ids: number[]) {
  if (ids.length === 0) return new Map<number, ServicioCatalogo>();
  const filas = await ej.select().from(servicios).where(inArray(servicios.id, ids));
  return new Map(filas.map((s) => [s.id, s]));
}

export type ValidacionCarrito = ResultadoCarrito & {
  reserva: EstadiaVinculada | null;
  error?: "carrito_invalido" | "reserva_invalida";
};

/** Recalcula precios y disponibilidad del carrito en el servidor. */
export async function validarCarrito(entrada: {
  items: unknown;
  reserva?: unknown;
}): Promise<ValidacionCarrito> {
  const vacio = { lineas: [], total: 0, valido: false, reserva: null };
  const items = esquemaItems.safeParse(entrada.items);
  if (!items.success) return { ...vacio, error: "carrito_invalido" };
  if (!hayBd()) return vacio;

  const reserva = entrada.reserva ? await vincularReserva(entrada.reserva) : null;
  if (entrada.reserva && !reserva) return { ...vacio, error: "reserva_invalida" };

  const ids = [...new Set(items.data.map((i) => i.servicioId))];
  const [catalogo, disp] = await Promise.all([
    catalogoDe(getDb(), ids),
    cargarDisponibilidad(getDb(), ids, null),
  ]);
  const opciones = { hoy: hoyEnBogota(), estadia: reserva };
  return { ...cotizarCarrito(items.data, catalogo, disp, opciones), reserva };
}

export type ResultadoPedido =
  | { ok: true; codigo: string; expiraEn: string; carrito: ResultadoCarrito }
  | { ok: false; error: "datos_invalidos"; errores: Record<string, string[] | undefined> }
  | { ok: false; error: "carrito_invalido"; carrito?: ResultadoCarrito }
  | { ok: false; error: "reserva_invalida" | "sin_configuracion" };

/**
 * Crea el pedido "pendiente" que aparta los cupos mientras el comprador paga.
 * Bloquea las filas de cupos y stock involucradas para que dos pedidos simultáneos
 * no aparten el mismo cupo. No descuenta stock: eso ocurre al confirmar el pago.
 */
export async function crearPedidoPendiente(entrada: {
  items: unknown;
  comprador: unknown;
  reserva?: unknown;
}): Promise<ResultadoPedido> {
  const items = esquemaItems.safeParse(entrada.items);
  if (!items.success || items.data.length === 0) return { ok: false, error: "carrito_invalido" };
  const comprador = esquemaComprador.safeParse(entrada.comprador);
  if (!comprador.success) {
    return {
      ok: false,
      error: "datos_invalidos",
      errores: z.flattenError(comprador.error).fieldErrors,
    };
  }
  if (!hayBd()) return { ok: false, error: "sin_configuracion" };

  const reserva = entrada.reserva ? await vincularReserva(entrada.reserva) : null;
  if (entrada.reserva && !reserva) return { ok: false, error: "reserva_invalida" };
  const reservaId = reserva
    ? (
        await getDb()
          .select({ id: reservas.id })
          .from(reservas)
          .where(eq(reservas.codigo, reserva.codigo))
      )[0]?.id
    : null;

  const { aceptaTerminos: _, ...datosComprador } = comprador.data;
  const ids = [...new Set(items.data.map((i) => i.servicioId))];

  return getDb().transaction(async (tx) => {
    // Libera los apartados vencidos antes de calcular disponibilidad.
    await tx
      .update(pedidos)
      .set({ estado: "expirado" })
      .where(and(eq(pedidos.estado, "pendiente"), lt(pedidos.expiraEn, sql`now()`)));

    const [config] = await tx.select().from(configuracion).limit(1);
    const catalogo = await catalogoDe(tx, ids);
    const disp = await cargarDisponibilidad(tx, ids, null, true);
    const carrito = cotizarCarrito(items.data, catalogo, disp, {
      hoy: hoyEnBogota(),
      estadia: reserva,
    });
    if (!carrito.valido) return { ok: false, error: "carrito_invalido", carrito } as const;

    const [pedido] = await tx
      .insert(pedidos)
      .values({
        codigo: nuevoCodigo("SRV"),
        reservaId,
        estado: "pendiente",
        totalCop: carrito.total,
        ...datosComprador,
        expiraEn: sql`now() + make_interval(mins => ${config?.minutosHold ?? 20})`,
        terminosVersion: config?.versionTerminos ?? "1",
      })
      .returning({ id: pedidos.id, codigo: pedidos.codigo, expiraEn: pedidos.expiraEn });

    await tx.insert(itemsPedido).values(
      carrito.lineas.map((l) => ({
        pedidoId: pedido!.id,
        servicioId: l.servicioId,
        fecha: l.fecha,
        turno: l.turno,
        cantidad: l.cantidad,
        precioUnitario: l.precioUnitario,
        subtotal: l.subtotal,
      })),
    );

    return {
      ok: true,
      codigo: pedido!.codigo,
      expiraEn: pedido!.expiraEn.toISOString(),
      carrito,
    } as const;
  });
}

/** Libera un pedido que sigue pendiente de pago (el comprador volvió atrás). */
export async function liberarPedidoPendiente(codigo: string) {
  if (!hayBd() || !/^SRV-[A-Z0-9]{8}$/.test(codigo)) return;
  await getDb()
    .update(pedidos)
    .set({ estado: "cancelado" })
    .where(and(eq(pedidos.codigo, codigo), eq(pedidos.estado, "pendiente")));
}

export type PedidoPublico = {
  codigo: string;
  estado: (typeof ESTADOS)[number];
  nombre: string;
  correo: string;
  totalCop: number;
  expiraEn: string;
  reserva: string | null;
  items: {
    nombre: string;
    slug: string;
    unidadPrecio: ServicioCatalogo["unidadPrecio"];
    fecha: string | null;
    turno: string | null;
    cantidad: number;
    subtotal: number;
  }[];
};

const ESTADOS = ["pendiente", "confirmado", "cancelado", "expirado"] as const;

/** Datos mínimos para la página del pedido (sin teléfono ni comentarios). */
export async function obtenerPedidoPublico(codigo: string): Promise<PedidoPublico | null> {
  if (!hayBd() || !/^SRV-[A-Z0-9]{8}$/.test(codigo)) return null;
  const [p] = await getDb()
    .select({ pedido: pedidos, reserva: reservas.codigo })
    .from(pedidos)
    .leftJoin(reservas, eq(reservas.id, pedidos.reservaId))
    .where(eq(pedidos.codigo, codigo))
    .limit(1);
  if (!p) return null;

  const filas = await getDb()
    .select({
      nombre: servicios.nombre,
      slug: servicios.slug,
      unidadPrecio: servicios.unidadPrecio,
      fecha: itemsPedido.fecha,
      turno: itemsPedido.turno,
      cantidad: itemsPedido.cantidad,
      subtotal: itemsPedido.subtotal,
    })
    .from(itemsPedido)
    .innerJoin(servicios, eq(servicios.id, itemsPedido.servicioId))
    .where(eq(itemsPedido.pedidoId, p.pedido.id))
    .orderBy(asc(itemsPedido.id));

  const vencido = p.pedido.estado === "pendiente" && p.pedido.expiraEn.getTime() < Date.now();
  return {
    codigo: p.pedido.codigo,
    estado: vencido ? "expirado" : p.pedido.estado,
    nombre: p.pedido.nombre.split(" ")[0] ?? p.pedido.nombre,
    correo: enmascararCorreo(p.pedido.correo),
    totalCop: p.pedido.totalCop,
    expiraEn: p.pedido.expiraEn.toISOString(),
    reserva: p.reserva,
    items: filas,
  };
}
