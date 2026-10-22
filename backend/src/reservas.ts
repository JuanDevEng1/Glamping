// Reservas: datos de tarifas desde la BD, calendario, cotización y hold (PLAN_DESARROLLO.md §5).
// Toda entrada se valida con Zod aquí; el precio siempre lo recalcula el servidor con precios.ts.
import { randomInt } from "node:crypto";
import { and, eq, gt, gte, lt, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  ajustesFecha,
  configuracion,
  festivos,
  getDb,
  reservas,
  temporadas,
  type Configuracion,
  type Db,
  type Tx,
} from "./db";
import { hoyEnBogota } from "./moneda";
import {
  calendarioMes,
  cotizar,
  diasEntre,
  esFechaValida,
  esMesValido,
  sumarDias,
  type Cotizacion,
  type DatosTarifas,
  type DiaCalendario,
  type ErrorCotizacion,
} from "./precios";

// ---------------------------------------------------------------------------
// Validación de entradas
// ---------------------------------------------------------------------------

const fecha = z.string().refine(esFechaValida, { error: "Fecha inválida" });

export const esquemaEstadia = z.object({
  llegada: fecha,
  salida: fecha,
  huespedes: z.coerce.number().int().min(1).max(6),
});

export const TIPOS_DOCUMENTO = {
  CC: "Cédula de ciudadanía",
  CE: "Cédula de extranjería",
  PA: "Pasaporte",
} as const;

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
  tipoDocumento: z.enum(["CC", "CE", "PA"], { error: "Elige el tipo de documento" }),
  documento: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{4,20}$/, { error: "Revisa el número de documento" }),
  correo: z.email({ error: "Revisa tu correo electrónico" }).max(200),
  telefono: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()-]{7,20}$/, { error: "Revisa tu número de celular" }),
  pais: z.string().trim().min(2, { error: "Escribe tu país" }).max(60),
  ciudad: opcional(80, "Máximo 80 caracteres"),
  comentarios: opcional(300, "Máximo 300 caracteres"),
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
const reservaActiva = or(
  eq(reservas.estado, "confirmada"),
  and(eq(reservas.estado, "pendiente"), gt(reservas.expiraEn, sql`now()`)),
);

/** Todo lo que el motor necesita para las noches de `desde` a `hasta` (inclusive). */
async function cargarDatos(
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
  Cotizacion | ErrorCotizacion | { ok: false; error: "sin_configuracion" };

export async function cotizarEstadia(entrada: unknown): Promise<ResultadoCotizacion> {
  const parsed = esquemaEstadia.safeParse(entrada);
  if (!parsed.success) return { ok: false, error: "fechas_invalidas" };
  const { llegada, salida } = parsed.data;
  if (salida <= llegada) return { ok: false, error: "fechas_invalidas" };
  if (!process.env.DATABASE_URL) return { ok: false, error: "sin_configuracion" };
  const datos = await cargarDatos(getDb(), llegada, sumarDias(salida, -1));
  if (!datos) return { ok: false, error: "sin_configuracion" };
  return cotizar(parsed.data, datos, hoyEnBogota());
}

// ---------------------------------------------------------------------------
// Crear, liberar y consultar reservas
// ---------------------------------------------------------------------------

const ALFABETO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Código no adivinable, ej. LAU-7KQ2M9XA (reservas) o SRV-… (pedidos de servicios). */
export function nuevoCodigo(prefijo: "LAU" | "SRV" = "LAU") {
  return `${prefijo}-${Array.from({ length: 8 }, () => ALFABETO[randomInt(ALFABETO.length)]).join("")}`;
}

function esViolacionSinCruce(error: unknown) {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code === "23P01" || e?.cause?.code === "23P01";
}

export type ResultadoCrear =
  | { ok: true; codigo: string; expiraEn: string; cotizacion: Cotizacion }
  | (ErrorCotizacion & { errores?: undefined })
  | { ok: false; error: "sin_configuracion" }
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

  const { llegada, salida, huespedes } = estadia.data;
  const { aceptaTerminos: _, ...datosHuesped } = huesped.data;
  if (salida <= llegada) return { ok: false, error: "fechas_invalidas" };

  try {
    return await getDb().transaction(async (tx) => {
      // Libera los holds vencidos antes de comprobar disponibilidad.
      await tx
        .update(reservas)
        .set({ estado: "expirada" })
        .where(and(eq(reservas.estado, "pendiente"), lt(reservas.expiraEn, sql`now()`)));

      const datos = await cargarDatos(tx, llegada, sumarDias(salida, -1));
      if (!datos) return { ok: false, error: "sin_configuracion" } as const;
      const cotizacion = cotizar(estadia.data, datos, hoyEnBogota());
      if (!cotizacion.ok) return cotizacion;

      const [fila] = await tx
        .insert(reservas)
        .values({
          codigo: nuevoCodigo(),
          fechaLlegada: llegada,
          fechaSalida: salida,
          huespedes,
          estado: "pendiente",
          totalCop: cotizacion.total,
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
    throw error;
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

export function enmascararCorreo(correo: string) {
  const [usuario = "", dominio = ""] = correo.split("@");
  return `${usuario.slice(0, 1)}***@${dominio}`;
}

export type ReservaPublica = {
  codigo: string;
  estado: (typeof reservas.$inferSelect)["estado"];
  nombre: string;
  correo: string;
  fechaLlegada: string;
  fechaSalida: string;
  huespedes: number;
  totalCop: number;
  expiraEn: string;
};

/** Datos mínimos para la página de confirmación (sin documento ni teléfono). */
export async function obtenerReservaPublica(codigo: string): Promise<ReservaPublica | null> {
  if (!process.env.DATABASE_URL || !/^LAU-[A-Z0-9]{8}$/.test(codigo)) return null;
  const [r] = await getDb()
    .select({
      codigo: reservas.codigo,
      estado: reservas.estado,
      nombre: reservas.nombre,
      correo: reservas.correo,
      fechaLlegada: reservas.fechaLlegada,
      fechaSalida: reservas.fechaSalida,
      huespedes: reservas.huespedes,
      totalCop: reservas.totalCop,
      expiraEn: reservas.expiraEn,
    })
    .from(reservas)
    .where(eq(reservas.codigo, codigo))
    .limit(1);
  if (!r) return null;
  // Un hold vencido se muestra como expirado aunque aún no se haya marcado en la BD.
  const estado =
    r.estado === "pendiente" && r.expiraEn.getTime() < Date.now() ? "expirada" : r.estado;
  return {
    ...r,
    estado,
    nombre: r.nombre.split(" ")[0] ?? r.nombre,
    correo: enmascararCorreo(r.correo),
    expiraEn: r.expiraEn.toISOString(),
  };
}
