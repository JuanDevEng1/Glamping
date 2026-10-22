import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  time,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Noche } from "./precios";

// ---------------------------------------------------------------------------
// Esquema (PLAN_DESARROLLO.md §3). Montos en COP como enteros.
// ---------------------------------------------------------------------------

/** Configuración general del glamping. Una sola fila (id = 1), editable desde el panel. */
export const configuracion = pgTable(
  "configuracion",
  {
    id: integer().primaryKey().default(1),
    precioBase: integer().notNull(),
    precioAlto: integer().notNull(),
    precioPersonaExtra: integer().notNull(),
    maxHuespedes: integer().notNull().default(6),
    huespedesIncluidos: integer().notNull().default(2),
    horaCheckin: time().notNull().default("15:00"),
    horaCheckout: time().notNull().default("12:00"),
    minimoNochesPuente: integer().notNull().default(1),
    versionTerminos: text().notNull().default("1"),
    /** Minutos que se apartan las fechas mientras el huésped paga. */
    minutosHold: integer().notNull().default(20),
    /** Si la noche del propio festivo (ej. lunes → martes) se cobra con tarifa alta. */
    nocheFestivoAlta: boolean().notNull().default(false),
  },
  (t) => [
    check("configuracion_fila_unica", sql`${t.id} = 1`),
    check(
      "configuracion_montos_positivos",
      sql`${t.precioBase} > 0 and ${t.precioAlto} > 0 and ${t.precioPersonaExtra} >= 0`,
    ),
  ],
);

/** Temporadas con tarifa propia. Fechas de noches, ambas inclusive. */
export const temporadas = pgTable(
  "temporadas",
  {
    id: serial().primaryKey(),
    nombre: text().notNull(),
    fechaInicio: date({ mode: "string" }).notNull(),
    fechaFin: date({ mode: "string" }).notNull(),
    precioNoche: integer().notNull(),
    precioPersonaExtra: integer(),
    minimoNoches: integer().notNull().default(1),
  },
  (t) => [
    check("temporadas_rango", sql`${t.fechaFin} >= ${t.fechaInicio}`),
    check("temporadas_precio", sql`${t.precioNoche} > 0`),
  ],
);

export const festivos = pgTable("festivos", {
  fecha: date({ mode: "string" }).primaryKey(),
  nombre: text().notNull(),
});

/** Precio especial o bloqueo de una noche concreta. */
export const ajustesFecha = pgTable("ajustes_fecha", {
  fecha: date({ mode: "string" }).primaryKey(),
  precio: integer(),
  bloqueada: boolean().notNull().default(false),
  motivo: text(),
});

export const ESTADOS_RESERVA = ["pendiente", "confirmada", "cancelada", "expirada"] as const;

/**
 * Reservas. La restricción anti doble reserva (EXCLUDE sobre daterange) está en la
 * migración personalizada 0002: Drizzle no la expresa en el esquema. No eliminarla.
 */
export const reservas = pgTable(
  "reservas",
  {
    id: serial().primaryKey(),
    codigo: text().notNull().unique(),
    fechaLlegada: date({ mode: "string" }).notNull(),
    fechaSalida: date({ mode: "string" }).notNull(),
    huespedes: integer().notNull(),
    estado: text({ enum: ESTADOS_RESERVA }).notNull().default("pendiente"),
    totalCop: integer().notNull(),
    desglose: jsonb().$type<Noche[]>().notNull(),
    nombre: text().notNull(),
    correo: text().notNull(),
    telefono: text().notNull(),
    tipoDocumento: text().notNull(),
    documento: text().notNull(),
    pais: text().notNull(),
    ciudad: text(),
    comentarios: text(),
    pasarela: text(),
    expiraEn: timestamp({ withTimezone: true }).notNull(),
    terminosVersion: text().notNull(),
    aceptaMarketing: boolean().notNull().default(false),
    creadaEn: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("reservas_fechas", sql`${t.fechaSalida} > ${t.fechaLlegada}`),
    check("reservas_huespedes", sql`${t.huespedes} between 1 and 6`),
    check(
      "reservas_estado",
      sql`${t.estado} in ('pendiente', 'confirmada', 'cancelada', 'expirada')`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Servicios con aliados (Fase 5)
// ---------------------------------------------------------------------------

export const aliados = pgTable("aliados", {
  id: serial().primaryKey(),
  nombre: text().notNull(),
  correo: text().notNull(),
  telefono: text(),
});

export const servicios = pgTable(
  "servicios",
  {
    id: serial().primaryKey(),
    slug: text().notNull().unique(),
    aliadoId: integer()
      .notNull()
      .references(() => aliados.id),
    nombre: text().notNull(),
    categoria: text({
      enum: ["tours", "fincas", "gastronomia", "decoracion", "transporte"],
    }).notNull(),
    resumen: text().notNull(),
    descripcion: text().notNull(),
    precio: integer().notNull(),
    unidadPrecio: text({ enum: ["persona", "pareja", "trayecto", "unidad"] }).notNull(),
    tipoStock: text({ enum: ["cupos", "unidades"] }).notNull(),
    /** Solo para tipoStock = unidades. Se descuenta al confirmar el pago. */
    stock: integer(),
    maxPorPedido: integer().notNull().default(4),
    incluidoOExtra: text({ enum: ["incluido", "extra"] })
      .notNull()
      .default("extra"),
    activo: boolean().notNull().default(true),
    orden: integer().notNull().default(0),
    duracion: text(),
    nivel: text(),
    puntoEncuentro: text(),
    turnos: jsonb().$type<string[]>().notNull().default([]),
    incluye: jsonb().$type<string[]>().notNull().default([]),
    noIncluye: jsonb().$type<string[]>().notNull().default([]),
    condiciones: jsonb().$type<{ titulo: string; texto: string }[]>().notNull().default([]),
    /** Descripción de cada foto mientras llegan las reales. TODO(cliente): fotos reales. */
    fotos: jsonb().$type<string[]>().notNull().default([]),
  },
  (t) => [
    check("servicios_precio", sql`${t.precio} >= 0`),
    check("servicios_stock", sql`${t.stock} is null or ${t.stock} >= 0`),
    check("servicios_max", sql`${t.maxPorPedido} >= 1`),
  ],
);

/** Capacidad por fecha y turno ('' = sin turno). `reservados` cuenta solo pedidos pagados. */
export const cuposServicio = pgTable(
  "cupos_servicio",
  {
    id: serial().primaryKey(),
    servicioId: integer()
      .notNull()
      .references(() => servicios.id),
    fecha: date({ mode: "string" }).notNull(),
    turno: text().notNull().default(""),
    capacidad: integer().notNull(),
    reservados: integer().notNull().default(0),
  },
  (t) => [
    unique("cupos_servicio_unico").on(t.servicioId, t.fecha, t.turno),
    check("cupos_servicio_rango", sql`${t.reservados} >= 0 and ${t.reservados} <= ${t.capacidad}`),
  ],
);

export const ESTADOS_PEDIDO = ["pendiente", "confirmado", "cancelado", "expirado"] as const;

export const pedidos = pgTable(
  "pedidos",
  {
    id: serial().primaryKey(),
    codigo: text().notNull().unique(),
    reservaId: integer().references(() => reservas.id),
    estado: text({ enum: ESTADOS_PEDIDO }).notNull().default("pendiente"),
    totalCop: integer().notNull(),
    nombre: text().notNull(),
    correo: text().notNull(),
    telefono: text().notNull(),
    comentarios: text(),
    expiraEn: timestamp({ withTimezone: true }).notNull(),
    terminosVersion: text().notNull(),
    aceptaMarketing: boolean().notNull().default(false),
    creadoEn: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "pedidos_estado",
      sql`${t.estado} in ('pendiente', 'confirmado', 'cancelado', 'expirado')`,
    ),
  ],
);

export const itemsPedido = pgTable(
  "items_pedido",
  {
    id: serial().primaryKey(),
    pedidoId: integer()
      .notNull()
      .references(() => pedidos.id, { onDelete: "cascade" }),
    servicioId: integer()
      .notNull()
      .references(() => servicios.id),
    fecha: date({ mode: "string" }),
    turno: text(),
    cantidad: integer().notNull(),
    precioUnitario: integer().notNull(),
    subtotal: integer().notNull(),
  },
  (t) => [check("items_pedido_cantidad", sql`${t.cantidad} >= 1`)],
);

export const schema = {
  configuracion,
  temporadas,
  festivos,
  ajustesFecha,
  reservas,
  aliados,
  servicios,
  cuposServicio,
  pedidos,
  itemsPedido,
};

// ---------------------------------------------------------------------------
// Conexión. Se crea al primer uso para que importar el esquema (drizzle-kit,
// build de Next) no exija DATABASE_URL.
// ---------------------------------------------------------------------------

function crearDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta la variable de entorno DATABASE_URL");
  return drizzle(postgres(url), { schema, casing: "snake_case" });
}

export type Db = ReturnType<typeof crearDb>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

let db: Db | undefined;

export function getDb() {
  db ??= crearDb();
  return db;
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

export type Configuracion = typeof configuracion.$inferSelect;

/**
 * Fila única de configuración, o null si aún no existe.
 * Sin DATABASE_URL (desarrollo o build sin BD) devuelve null; con BD, los errores no se ocultan.
 */
export async function obtenerConfiguracion(): Promise<Configuracion | null> {
  if (!process.env.DATABASE_URL) return null;
  const [fila] = await getDb().select().from(configuracion).limit(1);
  return fila ?? null;
}
