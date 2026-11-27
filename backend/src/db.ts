import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Noche } from "./precios";

// ---------------------------------------------------------------------------
// Esquema (PLAN_DESARROLLO.md §3). Montos en COP como enteros.
// ---------------------------------------------------------------------------

/** Configuración general del glamping. Una sola fila (id = 1); se edita con SQL (no hay panel). */
export const configuracion = pgTable(
  "configuracion",
  {
    id: integer().primaryKey().default(1),
    /** Entre semana (domingo a jueves). */
    precioBase: integer().notNull(),
    /** Fin de semana y puentes. */
    precioAlto: integer().notNull(),
    /** Temporada alta: noches dentro de una fila de `temporadas` sin precio propio. */
    precioTemporada: integer().notNull().default(560_000),
    /** Fecha especial: noches marcadas como `especial` en `ajustes_fecha` sin precio propio. */
    precioFechaEspecial: integer().notNull().default(650_000),
    precioPersonaExtra: integer().notNull(),
    /** Acompañantes por encima de maxHuespedes. Los menores de 4 años no pagan pero cuentan. */
    maxAdicionales: integer().notNull().default(4),
    /** Por noche, con desayuno. */
    precioAdicionalAdulto: integer().notNull().default(90_000),
    /** Por noche, niños de 4 a 11 años. */
    precioAdicionalNino: integer().notNull().default(60_000),
    /** Por mascota y por noche. Las mascotas no cuentan como huéspedes. */
    precioMascota: integer().notNull().default(50_000),
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
    /** Última TRM conocida (COP por 1 USD): respaldo si datos.gov.co no responde. */
    trmValor: numeric({ precision: 12, scale: 2 }),
    trmFecha: date({ mode: "string" }),
    /** Depósito de garantía por reserva (se autoriza en PayPal, no se cobra). 0 = sin depósito. */
    montoDeposito: integer().notNull().default(100_000),
  },
  (t) => [
    check("configuracion_fila_unica", sql`${t.id} = 1`),
    check(
      "configuracion_montos_positivos",
      sql`${t.precioBase} > 0 and ${t.precioAlto} > 0 and ${t.precioPersonaExtra} >= 0`,
    ),
    check(
      "configuracion_tarifas_positivas",
      sql`${t.precioTemporada} > 0 and ${t.precioFechaEspecial} > 0`,
    ),
    check(
      "configuracion_adicionales",
      sql`${t.maxAdicionales} >= 0 and ${t.precioAdicionalAdulto} >= 0 and ${t.precioAdicionalNino} >= 0`,
    ),
    check("configuracion_mascotas", sql`${t.precioMascota} >= 0`),
    check("configuracion_deposito", sql`${t.montoDeposito} >= 0`),
  ],
);

/** Temporada alta. Fechas de noches, ambas inclusive. Sin precio propio usa precioTemporada. */
export const temporadas = pgTable(
  "temporadas",
  {
    id: serial().primaryKey(),
    nombre: text().notNull(),
    fechaInicio: date({ mode: "string" }).notNull(),
    fechaFin: date({ mode: "string" }).notNull(),
    precioNoche: integer(),
    precioPersonaExtra: integer(),
    minimoNoches: integer().notNull().default(1),
  },
  (t) => [
    check("temporadas_rango", sql`${t.fechaFin} >= ${t.fechaInicio}`),
    check("temporadas_precio", sql`${t.precioNoche} is null or ${t.precioNoche} > 0`),
  ],
);

export const festivos = pgTable("festivos", {
  fecha: date({ mode: "string" }).primaryKey(),
  nombre: text().notNull(),
});

/**
 * Ajuste de una noche concreta: fecha especial (precioFechaEspecial), precio propio o bloqueo.
 * Un precio propio gana sobre `especial`.
 */
export const ajustesFecha = pgTable("ajustes_fecha", {
  fecha: date({ mode: "string" }).primaryKey(),
  precio: integer(),
  especial: boolean().notNull().default(false),
  bloqueada: boolean().notNull().default(false),
  motivo: text(),
});

/**
 * Códigos de descuento por porcentaje (solo reservas del glamping). Se crean con
 * `npm run admin -- codigo crear`. Los usos se cuentan sobre las reservas activas que lo llevan.
 */
export const codigosDescuento = pgTable(
  "codigos_descuento",
  {
    id: serial().primaryKey(),
    /** En mayúsculas. */
    codigo: text().notNull().unique(),
    /** 1 a 90: el total debe quedar > 0 para cobrarlo. Una estadía gratis es una cortesía. */
    porcentaje: integer().notNull(),
    activo: boolean().notNull().default(true),
    /** Días (en Bogotá) en que se puede usar, ambos inclusive. */
    validoDesde: date({ mode: "string" }),
    validoHasta: date({ mode: "string" }),
    /** Todas las noches de la estadía deben caer en este rango, ambos inclusive. */
    estadiaDesde: date({ mode: "string" }),
    estadiaHasta: date({ mode: "string" }),
    usosMaximos: integer(),
    descripcion: text(),
    creadoEn: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("codigos_descuento_porcentaje", sql`${t.porcentaje} between 1 and 90`),
    check("codigos_descuento_usos", sql`${t.usosMaximos} is null or ${t.usosMaximos} >= 1`),
    check("codigos_descuento_mayusculas", sql`${t.codigo} = upper(${t.codigo})`),
  ],
);

export const ESTADOS_RESERVA = ["pendiente", "confirmada", "cancelada", "expirada"] as const;

/** web = reserva pagada en el sitio; el resto las crea el admin sin pago. */
export const ORIGENES_RESERVA = ["web", "cortesia", "rifa", "mantenimiento"] as const;

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
    /** Grupo base (1 a 6). Los acompañantes por encima de 6 van en las columnas *Adicionales. */
    huespedes: integer().notNull(),
    adultosAdicionales: integer().notNull().default(0),
    /** De 4 a 11 años. */
    ninosAdicionales: integer().notNull().default(0),
    /** Menores de 4 años (no pagan). */
    menoresAdicionales: integer().notNull().default(0),
    mascotas: integer().notNull().default(0),
    estado: text({ enum: ESTADOS_RESERVA }).notNull().default("pendiente"),
    origen: text({ enum: ORIGENES_RESERVA }).notNull().default("web"),
    /** Motivo de una reserva del admin (rifa, cortesía, mantenimiento). */
    notaAdmin: text(),
    /** Total a cobrar, ya con el descuento aplicado. */
    totalCop: integer().notNull(),
    codigoDescuentoId: integer().references(() => codigosDescuento.id),
    descuentoCop: integer().notNull().default(0),
    /**
     * Cabalgata para todo el grupo (opcional). Sus cupos se ocupan mientras la reserva está
     * activa (confirmada o con hold vigente); `cabalgataCop` ya va incluido en `totalCop`.
     */
    /** Cuál de las cabalgatas (servicios con slug `cabalgata-…`). */
    cabalgataServicioId: integer().references((): AnyPgColumn => servicios.id),
    cabalgataFecha: date({ mode: "string" }),
    /** "HH:MM", o "" si el servicio no tiene turnos. */
    cabalgataTurno: text(),
    cabalgataPersonas: integer().notNull().default(0),
    cabalgataCop: integer().notNull().default(0),
    desglose: jsonb().$type<Noche[]>().notNull(),
    nombre: text().notNull(),
    correo: text().notNull(),
    telefono: text().notNull(),
    tipoDocumento: text().notNull(),
    documento: text().notNull(),
    pais: text().notNull(),
    ciudad: text(),
    comentarios: text(),
    /** Alergias o restricciones alimentarias del grupo. */
    alergias: text(),
    /** Obligatorios en reservas nuevas; nulos en las anteriores a este campo. */
    contactoEmergencia: text(),
    telefonoEmergencia: text(),
    pasarela: text(),
    expiraEn: timestamp({ withTimezone: true }).notNull(),
    terminosVersion: text().notNull(),
    aceptaMarketing: boolean().notNull().default(false),
    /** Cuándo se envió al admin el documento del titular. El archivo no se guarda. */
    documentoRecibidoEn: timestamp({ withTimezone: true }),
    creadaEn: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("reservas_fechas", sql`${t.fechaSalida} > ${t.fechaLlegada}`),
    check("reservas_huespedes", sql`${t.huespedes} between 1 and 6`),
    check(
      "reservas_adicionales",
      sql`${t.adultosAdicionales} >= 0 and ${t.ninosAdicionales} >= 0 and ${t.menoresAdicionales} >= 0`,
    ),
    check("reservas_mascotas", sql`${t.mascotas} >= 0`),
    check(
      "reservas_estado",
      sql`${t.estado} in ('pendiente', 'confirmada', 'cancelada', 'expirada')`,
    ),
    check("reservas_origen", sql`${t.origen} in ('web', 'cortesia', 'rifa', 'mantenimiento')`),
    check("reservas_descuento", sql`${t.descuentoCop} >= 0`),
    check(
      "reservas_cabalgata",
      sql`(${t.cabalgataServicioId} is null and ${t.cabalgataFecha} is null and ${t.cabalgataTurno} is null and ${t.cabalgataPersonas} = 0 and ${t.cabalgataCop} = 0) or (${t.cabalgataServicioId} is not null and ${t.cabalgataFecha} is not null and ${t.cabalgataTurno} is not null and ${t.cabalgataPersonas} > 0 and ${t.cabalgataCop} >= 0)`,
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

/**
 * Foto de un servicio. Sin `src` se muestra un recuadro con `alt` mientras llega la foto real.
 * `src` es una ruta de `frontend/public`. `credito` va cuando la licencia lo exige (p. ej. CC BY).
 */
export type Foto = {
  alt: string;
  src?: string;
  credito?: { autor: string; url: string; licencia: string; licenciaUrl: string };
};

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
    unidadPrecio: text({ enum: ["persona", "pareja", "trayecto", "unidad", "caballo"] }).notNull(),
    tipoStock: text({ enum: ["cupos", "unidades"] }).notNull(),
    /** Solo para tipoStock = unidades. Se descuenta al confirmar el pago. */
    stock: integer(),
    /**
     * Cabalgata: caballos por día (o por turno, si tiene turnos), todos los días. Una fila de
     * `cupos_servicio` para esa fecha y turno la reemplaza (0 = cerrado).
     */
    capacidadTurno: integer().notNull().default(6),
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
    fotos: jsonb().$type<Foto[]>().notNull().default([]),
  },
  (t) => [
    check("servicios_precio", sql`${t.precio} >= 0`),
    check("servicios_stock", sql`${t.stock} is null or ${t.stock} >= 0`),
    check("servicios_capacidad_turno", sql`${t.capacidadTurno} >= 0`),
    check("servicios_max", sql`${t.maxPorPedido} >= 1`),
  ],
);

/**
 * Capacidad por fecha y turno ('' = sin turno). `reservados` cuenta solo pedidos pagados.
 * Para la cabalgata de la reserva es una excepción a `servicios.capacidadTurno`.
 */
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

// ---------------------------------------------------------------------------
// Pagos (tarea pasarelas). Comunes a todas las pasarelas.
// ---------------------------------------------------------------------------

export const PASARELAS = ["paypal", "openpay", "wompi", "bold"] as const;
export const ESTADOS_PAGO = [
  "creado",
  "capturado",
  "aprobado",
  "rechazado",
  "reembolsado",
  "requiere_reembolso",
  // Solo depósitos de garantía (concepto = deposito):
  "autorizado", // Dinero apartado (PayPal Authorize / Openpay capture=false), sin cobrar.
  "cobrado", // El admin cobró daños desde la pasarela (total o parcial).
  "anulado", // Se liberó desde la pasarela o venció la autorización.
] as const;

/**
 * Un intento de cobro de una reserva o de un pedido, o un depósito de garantía de una
 * reserva (autorizar y capturar). Guarda el monto en la moneda de la pasarela y la TRM usada
 * (PayPal cobra en USD).
 */
export const pagos = pgTable(
  "pagos",
  {
    id: serial().primaryKey(),
    pasarela: text({ enum: PASARELAS }).notNull(),
    reservaId: integer().references(() => reservas.id),
    pedidoId: integer().references(() => pedidos.id),
    /** Id de la orden en la pasarela. Openpay: nuestro `order_id` (PSE no devuelve otro id). */
    idExterno: text().notNull(),
    /** PayPal: id de la captura. Openpay: id de la transacción (cargo). */
    idCaptura: text(),
    /** `deposito`: depósito de garantía autorizado (no cobrado) de una reserva. */
    concepto: text({ enum: ["cobro", "deposito"] })
      .notNull()
      .default("cobro"),
    /** Depósitos: id de la autorización vigente en PayPal (cambia si se reautoriza). */
    idAutorizacion: text(),
    autorizacionVenceEn: timestamp({ withTimezone: true }),
    estado: text({ enum: ESTADOS_PAGO }).notNull().default("creado"),
    montoCop: integer().notNull(),
    moneda: text({ enum: ["COP", "USD"] }).notNull(),
    /** Monto en la unidad que usa la pasarela: centavos para USD (PayPal), pesos para COP (Openpay, sin TRM). */
    montoMoneda: integer().notNull(),
    trm: numeric({ precision: 12, scale: 2 }),
    creadoEn: timestamp({ withTimezone: true }).notNull().defaultNow(),
    actualizadoEn: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("pagos_id_externo").on(t.pasarela, t.idExterno),
    check("pagos_destino", sql`(${t.reservaId} is null) <> (${t.pedidoId} is null)`),
    check(
      "pagos_estado",
      sql`${t.estado} in ('creado', 'capturado', 'aprobado', 'rechazado', 'reembolsado', 'requiere_reembolso', 'autorizado', 'cobrado', 'anulado')`,
    ),
    check("pagos_montos", sql`${t.montoCop} > 0 and ${t.montoMoneda} > 0`),
    check("pagos_concepto", sql`${t.concepto} in ('cobro', 'deposito')`),
    check("pagos_deposito_reserva", sql`${t.concepto} = 'cobro' or ${t.reservaId} is not null`),
    // Un solo depósito en curso por reserva (evita duplicados por doble clic).
    uniqueIndex("pagos_deposito_vigente")
      .on(t.reservaId)
      .where(sql`${t.concepto} = 'deposito' and ${t.estado} in ('creado', 'autorizado')`),
  ],
);

/** Eventos de webhook ya procesados: idempotencia por id de evento. */
export const eventosPasarela = pgTable(
  "eventos_pasarela",
  {
    id: serial().primaryKey(),
    pasarela: text({ enum: PASARELAS }).notNull(),
    idEvento: text().notNull(),
    tipo: text().notNull(),
    payload: jsonb().notNull(),
    recibidoEn: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("eventos_pasarela_unico").on(t.pasarela, t.idEvento)],
);

/**
 * Límite de peticiones por acción e IP (ventana fija). La clave va con hash: no se guardan IPs.
 * En Postgres y no en memoria porque el sitio corre en varias instancias sin servidor.
 */
export const limitesPeticiones = pgTable("limites_peticiones", {
  clave: text().primaryKey(),
  inicio: timestamp({ withTimezone: true }).notNull().defaultNow(),
  conteo: integer().notNull(),
});

export const schema = {
  configuracion,
  temporadas,
  festivos,
  ajustesFecha,
  codigosDescuento,
  reservas,
  aliados,
  servicios,
  cuposServicio,
  pedidos,
  itemsPedido,
  pagos,
  eventosPasarela,
  limitesPeticiones,
};

// ---------------------------------------------------------------------------
// Conexión. Se crea al primer uso para que importar el esquema (drizzle-kit,
// build de Next) no exija DATABASE_URL.
// ---------------------------------------------------------------------------

/**
 * Conexiones por proceso. Cada función de Netlify y cada worker del build crea su propio pool,
 * y el pooler de Supabase en modo sesión admite pocos clientes (pool_size, hoy 15): con el
 * máximo por defecto de postgres.js (10), dos workers del build ya lo agotan.
 */
const MAX_CONEXIONES = 3;

function crearDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta la variable de entorno DATABASE_URL");
  const cliente = postgres(url, {
    max: MAX_CONEXIONES,
    // Libera las conexiones ociosas para no ocupar cupos del pooler entre peticiones.
    idle_timeout: 20,
    // Sin sentencias preparadas: el pooler de Supabase en modo transacción no las admite.
    prepare: false,
  });
  return drizzle(cliente, { schema, casing: "snake_case" });
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

/** Respuesta de una acción pública que superó su límite de peticiones. */
export const DEMASIADAS_PETICIONES = { ok: false, error: "demasiadas_peticiones" } as const;

/**
 * Cuenta una petición de `clave` y dice si sigue dentro de `max` por cada `segundos`.
 * Un solo INSERT … ON CONFLICT: dos peticiones simultáneas no se saltan el conteo.
 * Sin DATABASE_URL (desarrollo sin BD) siempre permite.
 */
export async function permitirPeticion(clave: string, max: number, segundos: number) {
  if (!process.env.DATABASE_URL) return true;
  const hash = createHash("sha256").update(clave).digest("hex");
  const vencida = sql`${limitesPeticiones.inicio} < now() - make_interval(secs => ${segundos})`;
  const [fila] = await getDb()
    .insert(limitesPeticiones)
    .values({ clave: hash, conteo: 1 })
    .onConflictDoUpdate({
      target: limitesPeticiones.clave,
      set: {
        conteo: sql`case when ${vencida} then 1 else ${limitesPeticiones.conteo} + 1 end`,
        inicio: sql`case when ${vencida} then now() else ${limitesPeticiones.inicio} end`,
      },
    })
    .returning({ conteo: limitesPeticiones.conteo });
  // De vez en cuando se borran las ventanas viejas para que la tabla no crezca.
  if (Math.random() < 0.01) {
    await getDb()
      .delete(limitesPeticiones)
      .where(sql`${limitesPeticiones.inicio} < now() - interval '1 day'`);
  }
  return (fila?.conteo ?? 0) <= max;
}

/**
 * Error de BD apto para logs. El mensaje de Drizzle trae la consulta y sus parámetros
 * (nombre, correo, documento…); aquí solo queda el código y la restricción de Postgres.
 */
export function errorSinDatos(contexto: string, error: unknown) {
  const e = error as { code?: string; constraint_name?: string; cause?: unknown };
  const pg = (e?.cause ?? e) as { code?: string; constraint_name?: string };
  const detalle = [pg?.code, pg?.constraint_name].filter(Boolean).join(" ");
  return new Error(`${contexto}: error de base de datos${detalle ? ` (${detalle})` : ""}`);
}
