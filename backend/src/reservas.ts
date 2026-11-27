// Reservas: datos de tarifas desde la BD, calendario, cotización y hold (PLAN_DESARROLLO.md §5).
// Toda entrada se valida con Zod aquí; el precio siempre lo recalcula el servidor con precios.ts.
import { randomInt } from "node:crypto";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  like,
  lt,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { correoConfigurado, correosAdmin, enviarCorreo } from "./correos";
import {
  ajustesFecha,
  codigosDescuento,
  configuracion,
  cuposServicio,
  errorSinDatos,
  festivos,
  getDb,
  pagos,
  reservas,
  servicios,
  temporadas,
  type Configuracion,
  type Foto,
  type Db,
  type Tx,
} from "./db";
import { hoyEnBogota } from "./moneda";
import {
  agregarCabalgata,
  aplicarDescuento,
  calendarioMes,
  cotizar,
  detalleAdicionales,
  diasEntre,
  esFechaValida,
  esMesValido,
  opcionesCabalgata,
  personasCabalgata,
  SIN_ADICIONALES,
  sumarDias,
  textoPersonas,
  totalAdicionales,
  type Adicionales,
  type CodigoDescuento,
  type Cotizacion,
  type DatosCabalgata,
  type DatosTarifas,
  type DiaCalendario,
  type ErrorCotizacion,
  type OpcionCabalgata,
} from "./precios";

// ---------------------------------------------------------------------------
// Validación de entradas
// ---------------------------------------------------------------------------

const fecha = z.string().refine(esFechaValida, { error: "Fecha inválida" });

const cantidad = z.coerce.number().int().min(0).max(20).default(0);

/** Código de descuento: se normaliza a mayúsculas. Vacío = sin código. */
export const esquemaCodigoDescuento = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9-]{3,30}$/, { error: "Código inválido" });

// Los límites de negocio (máximo de adicionales, grupo base completo) los aplica cotizar().
export const esquemaEstadia = z.object({
  llegada: fecha,
  salida: fecha,
  huespedes: z.coerce.number().int().min(1).max(6),
  adicionales: z
    .object({ adultos: cantidad, ninos: cantidad, menores: cantidad })
    .default(SIN_ADICIONALES),
  // Un código mal escrito no invalida la estadía: cargarCodigo lo trata como inexistente.
  codigo: z
    .string()
    .max(60)
    .optional()
    .transform((v) => v?.trim().toUpperCase() || undefined),
  /** Cabalgata para todo el grupo: el día y el turno; el precio lo pone el servidor. */
  cabalgata: z
    .object({
      servicio: z.string().regex(/^cabalgata-[a-z0-9-]{1,60}$/),
      fecha,
      turno: z
        .string()
        .regex(/^(\d{2}:\d{2})?$/)
        .default(""),
    })
    .optional(),
  mascotas: cantidad,
});

export const TIPOS_DOCUMENTO = {
  CC: "Cédula de ciudadanía",
  CE: "Cédula de extranjería",
  PA: "Pasaporte",
} as const;

export type TipoDocumento = keyof typeof TIPOS_DOCUMENTO;

const celular = (error: string) =>
  z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()-]{7,20}$/, { error });

const opcional = (max: number, error: string) =>
  z
    .string()
    .trim()
    .max(max, { error })
    .optional()
    .transform((v) => v || null);

export const esquemaHuesped = z.object({
  nombre: z
    .string()
    .trim()
    .min(3, { error: "Escribe tu nombre completo" })
    .max(120, { error: "Máximo 120 caracteres" }),
  tipoDocumento: z.enum(Object.keys(TIPOS_DOCUMENTO) as [TipoDocumento, ...TipoDocumento[]], {
    error: "Elige el tipo de documento",
  }),
  documento: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{4,20}$/, { error: "Revisa el número de documento" }),
  correo: z.email({ error: "Revisa tu correo electrónico" }).max(200),
  telefono: celular("Revisa tu número de celular"),
  pais: z.string().trim().min(2, { error: "Escribe tu país" }).max(60),
  ciudad: opcional(80, "Máximo 80 caracteres"),
  comentarios: opcional(300, "Máximo 300 caracteres"),
  alergias: opcional(300, "Máximo 300 caracteres"),
  contactoEmergencia: z
    .string()
    .trim()
    .min(3, { error: "Escribe el nombre de tu contacto de emergencia" })
    .max(120, { error: "Máximo 120 caracteres" }),
  telefonoEmergencia: celular("Revisa el celular de tu contacto de emergencia"),
  aceptaTerminos: z.literal(true, {
    error: "Debes aceptar los términos y la política de cancelación",
  }),
  aceptaMarketing: z.boolean().default(false),
});

export type EntradaHuesped = z.input<typeof esquemaHuesped>;

// ---------------------------------------------------------------------------
// Datos de tarifas desde la BD
// ---------------------------------------------------------------------------

/** Reserva que ocupa sus noches: confirmada, o pendiente con hold vigente. */
export const reservaActiva = or(
  eq(reservas.estado, "confirmada"),
  and(eq(reservas.estado, "pendiente"), gt(reservas.expiraEn, sql`now()`)),
);

/** Usos de un código: reservas activas (confirmadas o con hold vigente) que lo llevan. */
export async function usosCodigo(ej: Db | Tx, codigoId: number) {
  const [fila] = await ej
    .select({ usos: count() })
    .from(reservas)
    .where(and(eq(reservas.codigoDescuentoId, codigoId), reservaActiva));
  return fila?.usos ?? 0;
}

/**
 * Código de descuento con sus usos actuales, o null si no existe. Con `bloquear`, toma un
 * bloqueo de fila hasta el fin de la transacción: dos reservas simultáneas con el mismo código
 * se atienden en fila y no superan `usosMaximos`.
 */
async function cargarCodigo(
  ej: Db | Tx,
  codigo: string,
  bloquear = false,
): Promise<(CodigoDescuento & { id: number }) | null> {
  if (!esquemaCodigoDescuento.safeParse(codigo).success) return null;
  const consulta = ej
    .select()
    .from(codigosDescuento)
    .where(eq(codigosDescuento.codigo, codigo))
    .limit(1);
  const [fila] = bloquear ? await consulta.for("update") : await consulta;
  if (!fila) return null;
  return { ...fila, usos: await usosCodigo(ej, fila.id) };
}

/** Todo lo que el motor necesita para las noches de `desde` a `hasta` (inclusive). */
export async function cargarDatos(
  ej: Db | Tx,
  desde: string,
  hasta: string,
): Promise<(DatosTarifas & { config: Configuracion }) | null> {
  const [config] = await ej.select().from(configuracion).limit(1);
  if (!config) return null;

  const [filasTemporadas, filasFestivos, filasAjustes, filasReservas] = await Promise.all([
    ej
      .select()
      .from(temporadas)
      .where(and(lte(temporadas.fechaInicio, hasta), gte(temporadas.fechaFin, desde))),
    // +1 día: una noche es puente si el día siguiente es festivo.
    ej
      .select()
      .from(festivos)
      .where(and(gte(festivos.fecha, desde), lte(festivos.fecha, sumarDias(hasta, 1)))),
    ej
      .select()
      .from(ajustesFecha)
      .where(and(gte(ajustesFecha.fecha, desde), lte(ajustesFecha.fecha, hasta))),
    ej
      .select({ llegada: reservas.fechaLlegada, salida: reservas.fechaSalida })
      .from(reservas)
      .where(
        and(reservaActiva, lte(reservas.fechaLlegada, hasta), gt(reservas.fechaSalida, desde)),
      ),
  ]);

  const nochesOcupadas = new Set<string>();
  for (const r of filasReservas) {
    for (let i = 0; i < diasEntre(r.llegada, r.salida); i++)
      nochesOcupadas.add(sumarDias(r.llegada, i));
  }

  return {
    config,
    temporadas: filasTemporadas,
    festivos: new Set(filasFestivos.map((f) => f.fecha)),
    ajustes: new Map(filasAjustes.map((a) => [a.fecha, a])),
    nochesOcupadas,
  };
}

// ---------------------------------------------------------------------------
// Calendario y cotización (lectura)
// ---------------------------------------------------------------------------

/** Meses que se pueden consultar: desde el actual hasta 18 meses después. */
export const MESES_CALENDARIO = 18;

export function mesPermitido(mes: string, hoy = hoyEnBogota()) {
  if (!esMesValido(mes)) return false;
  const actual = hoy.slice(0, 7);
  const [a = 0, m = 1] = actual.split("-").map(Number);
  const limite = new Date(Date.UTC(a, m - 1 + MESES_CALENDARIO, 1)).toISOString().slice(0, 7);
  return mes >= actual && mes <= limite;
}

/** Días del mes con precio y disponibilidad, o null si no hay BD/configuración o el mes no se permite. */
export async function obtenerCalendario(mes: string): Promise<DiaCalendario[] | null> {
  const hoy = hoyEnBogota();
  if (!process.env.DATABASE_URL || !mesPermitido(mes, hoy)) return null;
  const desde = `${mes}-01`;
  const [a = 0, m = 1] = mes.split("-").map(Number);
  const hasta = sumarDias(new Date(Date.UTC(a, m, 1)).toISOString().slice(0, 10), -1);
  const datos = await cargarDatos(getDb(), desde, hasta);
  return datos ? calendarioMes(mes, datos, hoy) : null;
}

export type ResultadoCotizacion =
  | Cotizacion
  | ErrorCotizacion
  | { ok: false; error: "sin_configuracion" | "demasiadas_peticiones" };

export async function cotizarEstadia(entrada: unknown): Promise<ResultadoCotizacion> {
  const parsed = esquemaEstadia.safeParse(entrada);
  if (!parsed.success) return { ok: false, error: "fechas_invalidas" };
  const { llegada, salida } = parsed.data;
  if (salida <= llegada) return { ok: false, error: "fechas_invalidas" };
  if (!process.env.DATABASE_URL) return { ok: false, error: "sin_configuracion" };
  const db = getDb();
  const datos = await cargarDatos(db, llegada, sumarDias(salida, -1));
  if (!datos) return { ok: false, error: "sin_configuracion" };
  const hoy = hoyEnBogota();
  const cotizacion = cotizar(parsed.data, datos, hoy);
  if (!cotizacion.ok) return cotizacion;
  return (await completarCotizacion(db, cotizacion, parsed.data, datos.config, hoy)).cotizacion;
}

/**
 * Aplica el código de descuento y la cabalgata pedidos a una cotización válida. Con
 * `bloquear` (dentro de la transacción que crea la reserva) toma las filas del código y de la
 * cabalgata, así dos reservas simultáneas no pasan el límite de usos ni de cupos.
 */
async function completarCotizacion(
  ej: Db | Tx,
  base: Cotizacion,
  estadia: z.infer<typeof esquemaEstadia>,
  config: Configuracion,
  hoy: string,
  bloquear = false,
): Promise<{ cotizacion: Cotizacion | ErrorCotizacion; codigoId: number | null }> {
  let cotizacion: Cotizacion | ErrorCotizacion = base;
  let codigoId: number | null = null;
  if (estadia.codigo) {
    const codigo = await cargarCodigo(ej, estadia.codigo, bloquear);
    cotizacion = aplicarDescuento(cotizacion, codigo, hoy);
    if (!cotizacion.ok) return { cotizacion, codigoId };
    codigoId = codigo!.id;
  }
  if (estadia.cabalgata && cotizacion.ok) {
    const { llegada, salida } = estadia;
    const [cabalgata] = await cargarCabalgatas(ej, config, llegada, salida, {
      slug: estadia.cabalgata.servicio,
      bloquear,
    });
    cotizacion = cabalgata
      ? agregarCabalgata(cotizacion, estadia.cabalgata, cabalgata.datos)
      : { ok: false, error: "cabalgata_invalida" };
  }
  return { cotizacion, codigoId };
}

// ---------------------------------------------------------------------------
// Cabalgatas (único servicio adicional, va dentro de la reserva)
// ---------------------------------------------------------------------------

/** Las cabalgatas son los servicios cuyo slug empieza así (ej. cabalgata-30-minutos). */
export const PREFIJO_CABALGATA = "cabalgata-";

/**
 * Cabalgatas y sus cupos libres por día y turno entre `desde` y `hasta` (inclusive): capacidad
 * (`capacidadTurno` o la excepción de `cupos_servicio`) menos las personas de las reservas
 * activas que la llevan. Sin `servicioId`, solo las activas. Con `bloquear` toma sus filas.
 */
export async function cargarCabalgatas(
  ej: Db | Tx,
  config: Pick<Configuracion, "horaCheckin" | "horaCheckout">,
  desde: string,
  hasta: string,
  opciones: {
    slug?: string;
    servicioId?: number;
    bloquear?: boolean;
    excluirReservaId?: number;
  } = {},
) {
  const consulta = ej
    .select()
    .from(servicios)
    .where(
      and(
        like(servicios.slug, `${PREFIJO_CABALGATA}%`),
        opciones.servicioId ? eq(servicios.id, opciones.servicioId) : eq(servicios.activo, true),
        opciones.slug ? eq(servicios.slug, opciones.slug) : undefined,
      ),
    )
    .orderBy(asc(servicios.orden), asc(servicios.id));
  const filas = opciones.bloquear ? await consulta.for("update") : await consulta;
  if (filas.length === 0) return [];
  const ids = filas.map((f) => f.id);

  const [excepciones, ocupadas] = await Promise.all([
    ej
      .select()
      .from(cuposServicio)
      .where(
        and(
          inArray(cuposServicio.servicioId, ids),
          gte(cuposServicio.fecha, desde),
          lte(cuposServicio.fecha, hasta),
        ),
      ),
    ej
      .select({
        servicioId: reservas.cabalgataServicioId,
        fecha: reservas.cabalgataFecha,
        turno: reservas.cabalgataTurno,
        personas: sql<number>`sum(${reservas.cabalgataPersonas})::int`,
      })
      .from(reservas)
      .where(
        and(
          reservaActiva,
          inArray(reservas.cabalgataServicioId, ids),
          gte(reservas.cabalgataFecha, desde),
          lte(reservas.cabalgataFecha, hasta),
          opciones.excluirReservaId ? ne(reservas.id, opciones.excluirReservaId) : undefined,
        ),
      )
      .groupBy(reservas.cabalgataServicioId, reservas.cabalgataFecha, reservas.cabalgataTurno),
  ]);

  const clave = (servicioId: number | null, fecha: string | null, turno: string | null) =>
    `${servicioId}|${fecha}|${turno}`;
  const capacidad = new Map(
    excepciones.map((e) => [clave(e.servicioId, e.fecha, e.turno), e.capacidad]),
  );
  const ocupado = new Map(ocupadas.map((o) => [clave(o.servicioId, o.fecha, o.turno), o.personas]));

  return filas.map((servicio) => {
    const turnos = servicio.turnos.length > 0 ? servicio.turnos : [""];
    const libres = new Map<string, number>();
    for (let dia = desde; dia <= hasta; dia = sumarDias(dia, 1)) {
      for (const turno of turnos) {
        const k = clave(servicio.id, dia, turno);
        const total = capacidad.get(k) ?? servicio.capacidadTurno;
        libres.set(`${dia}|${turno}`, Math.max(0, total - (ocupado.get(k) ?? 0)));
      }
    }
    const datos: DatosCabalgata = {
      servicioId: servicio.id,
      nombre: servicio.nombre,
      precioPersona: servicio.precio,
      turnos,
      horaCheckin: config.horaCheckin,
      horaCheckout: config.horaCheckout,
      libres,
    };
    return { servicio, datos };
  });
}

export type OpcionServicioCabalgata = {
  slug: string;
  nombre: string;
  resumen: string;
  duracion: string | null;
  incluye: string[];
  noIncluye: string[];
  condiciones: { titulo: string; texto: string }[];
  foto: Foto | null;
  /** Por caballo; va uno por persona. */
  precioPersona: number;
  /** Días (y turnos, si tiene) de la estadía con sus cupos libres. */
  dias: OpcionCabalgata[];
};

export type InfoCabalgata = {
  /** Caballos que hacen falta: todo el grupo, sin los menores de 4 años. */
  personas: number;
  cabalgatas: OpcionServicioCabalgata[];
};

/** Lo que el paso de huéspedes muestra de las cabalgatas para una estadía. Null si no hay. */
export async function obtenerCabalgata(entrada: unknown): Promise<InfoCabalgata | null> {
  const e = esquemaEstadia.safeParse(entrada);
  if (!e.success || !process.env.DATABASE_URL) return null;
  const { llegada, salida, huespedes, adicionales } = e.data;
  if (salida <= llegada || llegada < hoyEnBogota()) return null;
  const db = getDb();
  const [config] = await db.select().from(configuracion).limit(1);
  if (!config) return null;
  const filas = await cargarCabalgatas(db, config, llegada, salida);
  if (filas.length === 0) return null;
  const personas = personasCabalgata(huespedes, adicionales);
  return {
    personas,
    cabalgatas: filas.map(({ servicio, datos }) => ({
      slug: servicio.slug,
      nombre: servicio.nombre,
      resumen: servicio.resumen,
      duracion: servicio.duracion,
      incluye: servicio.incluye,
      noIncluye: servicio.noIncluye,
      condiciones: servicio.condiciones,
      foto: servicio.fotos.find((f) => f.src) ?? null,
      precioPersona: servicio.precio,
      dias: opcionesCabalgata(llegada, salida, personas, datos),
    })),
  };
}

// ---------------------------------------------------------------------------
// Crear, liberar y consultar reservas
// ---------------------------------------------------------------------------

const ALFABETO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Código no adivinable, ej. LAU-7KQ2M9XA (reservas) o SRV-… (pedidos de servicios). */
export function nuevoCodigo(prefijo: "LAU" | "SRV" = "LAU") {
  return `${prefijo}-${Array.from({ length: 8 }, () => ALFABETO[randomInt(ALFABETO.length)]).join("")}`;
}

export function esViolacionSinCruce(error: unknown) {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code === "23P01" || e?.cause?.code === "23P01";
}

export type ResultadoCrear =
  | { ok: true; codigo: string; expiraEn: string; cotizacion: Cotizacion }
  | (ErrorCotizacion & { errores?: undefined })
  | { ok: false; error: "sin_configuracion" | "demasiadas_peticiones" }
  | { ok: false; error: "datos_invalidos"; errores: Record<string, string[] | undefined> };

/**
 * Crea la reserva "pendiente" que aparta las fechas por `minutosHold` minutos.
 * Recalcula el precio en el servidor. La restricción reservas_sin_cruce de Postgres
 * impide la doble reserva aunque dos personas lleguen aquí al mismo tiempo.
 */
export async function crearReservaPendiente(entrada: {
  estadia: unknown;
  huesped: unknown;
}): Promise<ResultadoCrear> {
  const estadia = esquemaEstadia.safeParse(entrada.estadia);
  if (!estadia.success) return { ok: false, error: "fechas_invalidas" };
  const huesped = esquemaHuesped.safeParse(entrada.huesped);
  if (!huesped.success) {
    return {
      ok: false,
      error: "datos_invalidos",
      errores: z.flattenError(huesped.error).fieldErrors,
    };
  }
  if (!process.env.DATABASE_URL) return { ok: false, error: "sin_configuracion" };

  const { llegada, salida, huespedes, adicionales, mascotas } = estadia.data;
  const { aceptaTerminos: _, ...datosHuesped } = huesped.data;
  if (salida <= llegada) return { ok: false, error: "fechas_invalidas" };

  try {
    return await getDb().transaction(async (tx) => {
      // Libera los holds vencidos antes de comprobar disponibilidad (y los usos de códigos).
      await tx
        .update(reservas)
        .set({ estado: "expirada" })
        .where(and(eq(reservas.estado, "pendiente"), lt(reservas.expiraEn, sql`now()`)));

      const datos = await cargarDatos(tx, llegada, sumarDias(salida, -1));
      if (!datos) return { ok: false, error: "sin_configuracion" } as const;
      const hoy = hoyEnBogota();
      const base = cotizar(estadia.data, datos, hoy);
      if (!base.ok) return base;
      const { cotizacion, codigoId } = await completarCotizacion(
        tx,
        base,
        estadia.data,
        datos.config,
        hoy,
        true,
      );
      if (!cotizacion.ok) return cotizacion;
      const { cabalgata } = cotizacion;

      const [fila] = await tx
        .insert(reservas)
        .values({
          codigo: nuevoCodigo(),
          fechaLlegada: llegada,
          fechaSalida: salida,
          huespedes,
          adultosAdicionales: adicionales.adultos,
          ninosAdicionales: adicionales.ninos,
          menoresAdicionales: adicionales.menores,
          mascotas,
          estado: "pendiente",
          totalCop: cotizacion.total,
          codigoDescuentoId: codigoId,
          descuentoCop: cotizacion.descuento?.monto ?? 0,
          cabalgataServicioId: cabalgata?.servicioId ?? null,
          cabalgataFecha: cabalgata?.fecha ?? null,
          cabalgataTurno: cabalgata?.turno ?? null,
          cabalgataPersonas: cabalgata?.personas ?? 0,
          cabalgataCop: cabalgata?.subtotal ?? 0,
          desglose: cotizacion.noches,
          ...datosHuesped,
          expiraEn: sql`now() + make_interval(mins => ${datos.config.minutosHold})`,
          terminosVersion: datos.config.versionTerminos,
        })
        .returning({ codigo: reservas.codigo, expiraEn: reservas.expiraEn });

      return {
        ok: true,
        codigo: fila!.codigo,
        expiraEn: fila!.expiraEn.toISOString(),
        cotizacion,
      } as const;
    });
  } catch (error) {
    if (esViolacionSinCruce(error)) return { ok: false, error: "no_disponible" };
    throw errorSinDatos("No se pudo crear la reserva", error);
  }
}

/** Libera una reserva que sigue pendiente de pago (el huésped volvió atrás). */
export async function liberarReservaPendiente(codigo: string) {
  if (!process.env.DATABASE_URL || !/^LAU-[A-Z0-9]{8}$/.test(codigo)) return;
  await getDb()
    .update(reservas)
    .set({ estado: "cancelada" })
    .where(and(eq(reservas.codigo, codigo), eq(reservas.estado, "pendiente")));
}

/**
 * Confirma una reserva pagada, dentro de la transacción del webhook. Si su hold ya venció o
 * se canceló, intenta confirmarla igual: reservas_sin_cruce lo impide si otra reserva tomó
 * esas noches. Corre en un savepoint para que ese error no aborte la transacción `tx`.
 * Si lleva cabalgata, recuenta sus cupos sin contarse a sí misma: si otra reserva los tomó
 * mientras su hold estaba vencido, devuelve "sin_cupo" y no confirma nada.
 * Es común a todas las pasarelas: cada webhook la llama con su nombre.
 */
export async function confirmarReserva(
  tx: Tx,
  reservaId: number,
  pasarela: string,
): Promise<"confirmada" | "no_disponible" | "sin_cupo"> {
  try {
    await tx.transaction(async (sp) => {
      const [r] = await sp
        .select({
          servicioId: reservas.cabalgataServicioId,
          fecha: reservas.cabalgataFecha,
          turno: reservas.cabalgataTurno,
          personas: reservas.cabalgataPersonas,
        })
        .from(reservas)
        .where(eq(reservas.id, reservaId));
      if (r?.servicioId && r.fecha && r.turno !== null) {
        const [config] = await sp.select().from(configuracion).limit(1);
        const [cabalgata] = config
          ? await cargarCabalgatas(sp, config, r.fecha, r.fecha, {
              servicioId: r.servicioId,
              bloquear: true,
              excluirReservaId: reservaId,
            })
          : [];
        const libres = cabalgata?.datos.libres.get(`${r.fecha}|${r.turno}`) ?? 0;
        if (r.personas > libres) throw new SinCupoCabalgata();
      }
      // Un hold vencido que siga "pendiente" también cuenta para la restricción.
      await sp
        .update(reservas)
        .set({ estado: "expirada" })
        .where(
          and(
            eq(reservas.estado, "pendiente"),
            lt(reservas.expiraEn, sql`now()`),
            ne(reservas.id, reservaId),
          ),
        );
      await sp
        .update(reservas)
        .set({ estado: "confirmada", pasarela })
        .where(eq(reservas.id, reservaId));
    });
    return "confirmada";
  } catch (error) {
    if (esViolacionSinCruce(error)) return "no_disponible";
    if (error instanceof SinCupoCabalgata) return "sin_cupo";
    throw error;
  }
}

class SinCupoCabalgata extends Error {}

export function enmascararCorreo(correo: string) {
  const [usuario = "", dominio = ""] = correo.split("@");
  return `${usuario.slice(0, 1)}***@${dominio}`;
}

export type ReservaPublica = {
  codigo: string;
  estado: (typeof reservas.$inferSelect)["estado"];
  origen: (typeof reservas.$inferSelect)["origen"];
  nombre: string;
  correo: string;
  fechaLlegada: string;
  fechaSalida: string;
  huespedes: number;
  adicionales: Adicionales;
  mascotas: number;
  totalCop: number;
  expiraEn: string;
  documentoRecibido: boolean;
  cabalgata: {
    nombre: string;
    fecha: string;
    turno: string;
    personas: number;
    totalCop: number;
  } | null;
  /** Null si el glamping no pide depósito (montoDeposito = 0). */
  deposito: DepositoPublico | null;
};

// ---------------------------------------------------------------------------
// Depósito de garantía: se autoriza en el paso de pago, antes del cobro (ver pagos.ts)
// ---------------------------------------------------------------------------

export type DepositoPublico = {
  montoCop: number;
  /** Pasarela con la que se autorizó. */
  pasarela: "paypal" | "openpay";
  estado: "sin_iniciar" | "verificando" | "autorizado" | "cobrado" | "liberado";
  /** Fecha aproximada en que el banco libera la retención (solo si sigue vigente). */
  venceEn: string | null;
};

type FilaDeposito = Pick<
  typeof pagos.$inferSelect,
  "estado" | "idAutorizacion" | "autorizacionVenceEn"
>;

/** Estado visible del último intento de depósito de una reserva. */
function estadoDeposito(fila: FilaDeposito | undefined): DepositoPublico["estado"] {
  if (!fila) return "sin_iniciar";
  switch (fila.estado) {
    case "autorizado":
      return "autorizado";
    case "cobrado":
      return "cobrado";
    case "creado":
      // Con autorización pedida a PayPal: falta el webhook. Sin ella: intento sin terminar.
      return fila.idAutorizacion ? "verificando" : "sin_iniciar";
    case "anulado":
      return fila.idAutorizacion ? "liberado" : "sin_iniciar";
    case "reembolsado":
      return "liberado";
    default:
      return "sin_iniciar";
  }
}

function adicionalesDe(r: {
  adultosAdicionales: number;
  ninosAdicionales: number;
  menoresAdicionales: number;
}): Adicionales {
  return {
    adultos: r.adultosAdicionales,
    ninos: r.ninosAdicionales,
    menores: r.menoresAdicionales,
  };
}

/** Datos mínimos para la página de confirmación (sin documento ni teléfono). */
export async function obtenerReservaPublica(codigo: string): Promise<ReservaPublica | null> {
  if (!process.env.DATABASE_URL || !/^LAU-[A-Z0-9]{8}$/.test(codigo)) return null;
  const [r] = await getDb()
    .select({
      codigo: reservas.codigo,
      estado: reservas.estado,
      origen: reservas.origen,
      nombre: reservas.nombre,
      correo: reservas.correo,
      fechaLlegada: reservas.fechaLlegada,
      fechaSalida: reservas.fechaSalida,
      huespedes: reservas.huespedes,
      adultosAdicionales: reservas.adultosAdicionales,
      ninosAdicionales: reservas.ninosAdicionales,
      menoresAdicionales: reservas.menoresAdicionales,
      mascotas: reservas.mascotas,
      totalCop: reservas.totalCop,
      expiraEn: reservas.expiraEn,
      documentoRecibidoEn: reservas.documentoRecibidoEn,
      cabalgataFecha: reservas.cabalgataFecha,
      cabalgataTurno: reservas.cabalgataTurno,
      cabalgataPersonas: reservas.cabalgataPersonas,
      cabalgataCop: reservas.cabalgataCop,
      cabalgataNombre: servicios.nombre,
      id: reservas.id,
      montoDeposito: configuracion.montoDeposito,
    })
    .from(reservas)
    .leftJoin(configuracion, eq(configuracion.id, 1))
    .leftJoin(servicios, eq(servicios.id, reservas.cabalgataServicioId))
    .where(eq(reservas.codigo, codigo))
    .limit(1);
  if (!r) return null;
  const [ultimoDeposito] = r.montoDeposito
    ? await getDb()
        .select({
          estado: pagos.estado,
          pasarela: pagos.pasarela,
          idAutorizacion: pagos.idAutorizacion,
          autorizacionVenceEn: pagos.autorizacionVenceEn,
        })
        .from(pagos)
        .where(and(eq(pagos.reservaId, r.id), eq(pagos.concepto, "deposito")))
        .orderBy(desc(pagos.id))
        .limit(1)
    : [];
  const deposito: DepositoPublico | null = r.montoDeposito
    ? {
        montoCop: r.montoDeposito,
        pasarela: ultimoDeposito?.pasarela === "openpay" ? "openpay" : "paypal",
        estado: estadoDeposito(ultimoDeposito),
        venceEn:
          ultimoDeposito?.estado === "autorizado" || ultimoDeposito?.estado === "creado"
            ? (ultimoDeposito.autorizacionVenceEn?.toISOString() ?? null)
            : null,
      }
    : null;
  // Un hold vencido se muestra como expirado aunque aún no se haya marcado en la BD.
  const estado =
    r.estado === "pendiente" && r.expiraEn.getTime() < Date.now() ? "expirada" : r.estado;
  const {
    documentoRecibidoEn,
    adultosAdicionales: _a,
    ninosAdicionales: _n,
    menoresAdicionales: _m,
    cabalgataFecha,
    cabalgataTurno,
    cabalgataPersonas,
    cabalgataCop,
    cabalgataNombre,
    id: _id,
    montoDeposito: _d,
    ...resto
  } = r;
  return {
    ...resto,
    adicionales: adicionalesDe(r),
    estado,
    nombre: r.nombre.split(" ")[0] ?? r.nombre,
    correo: enmascararCorreo(r.correo),
    expiraEn: r.expiraEn.toISOString(),
    documentoRecibido: documentoRecibidoEn !== null,
    cabalgata:
      cabalgataFecha && cabalgataTurno !== null
        ? {
            nombre: cabalgataNombre ?? "Cabalgata",
            fecha: cabalgataFecha,
            turno: cabalgataTurno,
            personas: cabalgataPersonas,
            totalCop: cabalgataCop,
          }
        : null,
    deposito,
  };
}

// ---------------------------------------------------------------------------
// Documento de identidad del titular (después de pagar)
// ---------------------------------------------------------------------------

/** 4 MB: con el resto del formulario queda bajo el límite de 5 MB de las server actions. */
export const MAX_BYTES_DOCUMENTO = 4 * 1024 * 1024;

const FIRMAS_ARCHIVO = [
  { extension: "jpg", bytes: [0xff, 0xd8, 0xff] },
  { extension: "png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { extension: "pdf", bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // "%PDF-"
] as const;

/** Extensión según los primeros bytes, no según el nombre ni el tipo que declara el navegador. */
export function extensionDocumento(bytes: Uint8Array) {
  return FIRMAS_ARCHIVO.find((f) => f.bytes.every((b, i) => bytes[i] === b))?.extension ?? null;
}

export type ResultadoDocumento =
  | { ok: true }
  | {
      ok: false;
      error:
        | "datos_invalidos"
        | "archivo_invalido"
        | "archivo_grande"
        | "no_disponible"
        | "ya_recibido"
        | "error_correo"
        | "demasiadas_peticiones"
        | "sin_configuracion";
    };

const fechaLarga = (fecha: string) =>
  new Intl.DateTimeFormat("es-CO", { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(`${fecha}T00:00:00Z`),
  );

/** "15:00:00" → "3:00 p. m." (igual que formatoHora del frontend). */
const horaCorta = (hora: string) => {
  const [h = 0, m = 0] = hora.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "a. m." : "p. m."}`;
};

/**
 * Envía al admin, como adjunto, el documento que sube el titular de una reserva confirmada.
 * El archivo no se guarda: solo se marca `documentoRecibidoEn`. Se acepta uno por reserva.
 */
export async function recibirDocumentoReserva(
  codigo: unknown,
  archivo: unknown,
): Promise<ResultadoDocumento> {
  if (typeof codigo !== "string" || !/^LAU-[A-Z0-9]{8}$/.test(codigo) || !(archivo instanceof Blob))
    return { ok: false, error: "datos_invalidos" };
  const admin = correosAdmin();
  if (!process.env.DATABASE_URL || !correoConfigurado() || admin.length === 0)
    return { ok: false, error: "sin_configuracion" };
  if (archivo.size > MAX_BYTES_DOCUMENTO) return { ok: false, error: "archivo_grande" };
  const bytes = new Uint8Array(await archivo.arrayBuffer());
  const extension = extensionDocumento(bytes);
  if (!extension) return { ok: false, error: "archivo_invalido" };

  const db = getDb();
  const [r] = await db.select().from(reservas).where(eq(reservas.codigo, codigo)).limit(1);
  if (!r || r.estado !== "confirmada") return { ok: false, error: "no_disponible" };
  if (r.documentoRecibidoEn) return { ok: false, error: "ya_recibido" };

  const [config] = await db
    .select({ horaCheckin: configuracion.horaCheckin, horaCheckout: configuracion.horaCheckout })
    .from(configuracion)
    .limit(1);
  const noches = diasEntre(r.fechaLlegada, r.fechaSalida);
  const tipo = TIPOS_DOCUMENTO[r.tipoDocumento as TipoDocumento] ?? r.tipoDocumento;
  const adicionales = adicionalesDe(r);
  const desde = config ? `, desde las ${horaCorta(config.horaCheckin)}` : "";
  const hasta = config ? `, hasta las ${horaCorta(config.horaCheckout)}` : "";
  try {
    await enviarCorreo({
      para: admin,
      asunto: `Documento de la reserva ${r.codigo}`,
      texto: [
        `El titular de la reserva ${r.codigo} envió su documento de identidad. Va adjunto.`,
        "",
        `Titular: ${r.nombre}`,
        `Documento registrado: ${tipo} ${r.documento}`,
        `Llegada (check-in): ${fechaLarga(r.fechaLlegada)}${desde}`,
        `Salida (check-out): ${fechaLarga(r.fechaSalida)}${hasta} (${noches} ${noches === 1 ? "noche" : "noches"})`,
        `Huéspedes: ${textoPersonas(r.huespedes, adicionales)}`,
        ...(totalAdicionales(adicionales) > 0
          ? [`Adicionales: ${detalleAdicionales(adicionales).join(", ")}`]
          : []),
        ...(r.mascotas > 0 ? [`Mascotas: ${r.mascotas}`] : []),
        `Alergias o restricciones alimentarias: ${r.alergias ?? "ninguna indicada"}`,
        `Correo: ${r.correo}`,
        `Celular: ${r.telefono}`,
        ...(r.contactoEmergencia
          ? [`Contacto de emergencia: ${r.contactoEmergencia} · ${r.telefonoEmergencia ?? ""}`]
          : []),
        "",
        "Al hacer el check-in, compara este documento con el original para confirmar que es la misma persona que reservó.",
        "",
        "Este correo tiene datos personales: no lo reenvíes y bórralo cuando ya no lo necesites.",
      ].join("\n"),
      adjuntos: [{ nombre: `${r.codigo}-documento.${extension}`, contenido: bytes }],
    });
  } catch (error) {
    console.error(
      `No se pudo enviar el documento de la reserva ${r.codigo}:`,
      error instanceof Error ? error.message : error,
    );
    return { ok: false, error: "error_correo" };
  }

  await db
    .update(reservas)
    .set({ documentoRecibidoEn: sql`now()` })
    .where(and(eq(reservas.id, r.id), isNull(reservas.documentoRecibidoEn)));
  return { ok: true };
}
