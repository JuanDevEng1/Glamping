// Operaciones del administrador: reservas sin pago (cortesía, rifa, mantenimiento), códigos de
// descuento y cupos de la cabalgata. No hay panel: solo las usa scripts/admin.ts desde la terminal.
// Las reservas del admin van en la tabla `reservas`, así pasan por reservas_sin_cruce y no pueden
// cruzarse con una reserva web.
import { and, asc, eq, gt, gte, inArray, isNotNull, lt, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { correosAdmin } from "./correos";
import { codigosDescuento, cuposServicio, getDb, reservas, servicios } from "./db";
import { hoyEnBogota } from "./moneda";
import { clasificarNoche, diasEntre, esFechaValida, sumarDias } from "./precios";
import {
  cargarDatos,
  esquemaCodigoDescuento,
  esquemaHuesped,
  esViolacionSinCruce,
  nuevoCodigo,
  reservaActiva,
  SLUG_CABALGATA,
  usosCodigo,
} from "./reservas";

const fecha = z.string().refine(esFechaValida, { error: "Fecha inválida (usa AAAA-MM-DD)" });

type Errores = Record<string, string[] | undefined>;

const errores = (error: z.ZodError) => z.flattenError(error).fieldErrors as Errores;

// ---------------------------------------------------------------------------
// Reservas del admin
// ---------------------------------------------------------------------------

/** Un bloqueo de mantenimiento puede ser más largo que una estadía en línea. */
const MAXIMO_NOCHES_ADMIN = 90;

const esquemaReservaAdmin = z.object({
  origen: z.enum(["cortesia", "rifa", "mantenimiento"], {
    error: "El tipo debe ser cortesia, rifa o mantenimiento",
  }),
  llegada: fecha,
  salida: fecha,
  motivo: z
    .string({ error: "Escribe el motivo" })
    .trim()
    .min(3, { error: "Escribe el motivo" })
    .max(300),
  huespedes: z.coerce.number().int().min(1).max(6).default(2),
});

/** Datos del beneficiario de una cortesía o rifa. El documento lo puede subir después. */
const esquemaBeneficiario = esquemaHuesped
  .pick({ nombre: true, correo: true, telefono: true })
  .extend({
    tipoDocumento: esquemaHuesped.shape.tipoDocumento.optional(),
    documento: esquemaHuesped.shape.documento.optional(),
    pais: esquemaHuesped.shape.pais.default("Colombia"),
  });

export type ReservaChoque = {
  codigo: string;
  origen: string;
  estado: string;
  fechaLlegada: string;
  fechaSalida: string;
};

export type ResultadoReservaAdmin =
  | { ok: true; codigo: string; noches: number }
  | { ok: false; error: "datos_invalidos"; errores: Errores }
  | { ok: false; error: "fechas_invalidas" | "sin_configuracion" }
  | { ok: false; error: "no_disponible"; choques: ReservaChoque[] };

/**
 * Crea una reserva confirmada sin pago (total 0). No exige mínimo de noches ni mira los
 * bloqueos de `ajustes_fecha`; sí rechaza fechas pasadas y cualquier cruce con otra reserva.
 */
export async function crearReservaAdmin(entrada: unknown): Promise<ResultadoReservaAdmin> {
  const base = esquemaReservaAdmin.safeParse(entrada);
  if (!base.success) return { ok: false, error: "datos_invalidos", errores: errores(base.error) };
  const { origen, llegada, salida, motivo } = base.data;
  const noches = diasEntre(llegada, salida);
  if (llegada < hoyEnBogota() || noches < 1 || noches > MAXIMO_NOCHES_ADMIN)
    return { ok: false, error: "fechas_invalidas" };

  let titular;
  if (origen === "mantenimiento") {
    titular = {
      nombre: "Mantenimiento",
      correo: correosAdmin()[0] ?? "admin@lauburu.invalid",
      telefono: "-",
      tipoDocumento: "Documento",
      documento: "sin registrar",
      pais: "-",
      huespedes: 1,
    };
  } else {
    const b = esquemaBeneficiario.safeParse(entrada);
    if (!b.success) return { ok: false, error: "datos_invalidos", errores: errores(b.error) };
    titular = {
      ...b.data,
      // Sin documento: el beneficiario lo sube desde la página de confirmación.
      tipoDocumento: b.data.tipoDocumento ?? "Documento",
      documento: b.data.documento ?? "sin registrar",
      huespedes: base.data.huespedes,
    };
  }

  try {
    return await getDb().transaction(async (tx) => {
      // Un hold vencido que siga "pendiente" también cuenta para la restricción.
      await tx
        .update(reservas)
        .set({ estado: "expirada" })
        .where(and(eq(reservas.estado, "pendiente"), lt(reservas.expiraEn, sql`now()`)));

      const datos = await cargarDatos(tx, llegada, sumarDias(salida, -1));
      if (!datos) return { ok: false, error: "sin_configuracion" } as const;
      // Precio de referencia de cada noche: queda en el desglose aunque no se cobre.
      const desglose = Array.from({ length: noches }, (_, i) =>
        clasificarNoche(sumarDias(llegada, i), datos),
      );

      const [fila] = await tx
        .insert(reservas)
        .values({
          codigo: nuevoCodigo(),
          fechaLlegada: llegada,
          fechaSalida: salida,
          estado: "confirmada",
          origen,
          notaAdmin: motivo,
          totalCop: 0,
          desglose,
          ...titular,
          expiraEn: sql`now()`,
          terminosVersion: datos.config.versionTerminos,
        })
        .returning({ codigo: reservas.codigo });
      return { ok: true, codigo: fila!.codigo, noches } as const;
    });
  } catch (error) {
    if (!esViolacionSinCruce(error)) throw error;
    const choques = await getDb()
      .select({
        codigo: reservas.codigo,
        origen: reservas.origen,
        estado: reservas.estado,
        fechaLlegada: reservas.fechaLlegada,
        fechaSalida: reservas.fechaSalida,
      })
      .from(reservas)
      .where(
        and(reservaActiva, lt(reservas.fechaLlegada, salida), gt(reservas.fechaSalida, llegada)),
      );
    return { ok: false, error: "no_disponible", choques };
  }
}

export type ResultadoCancelarAdmin =
  { ok: true } | { ok: false; error: "no_encontrada" | "es_web" | "no_confirmada" };

/**
 * Cancela una reserva del admin y libera sus noches. Las reservas web no se tocan aquí:
 * están pagadas y cancelarlas exige un reembolso.
 */
export async function cancelarReservaAdmin(codigo: string): Promise<ResultadoCancelarAdmin> {
  const db = getDb();
  const [r] = await db
    .select({ id: reservas.id, origen: reservas.origen, estado: reservas.estado })
    .from(reservas)
    .where(eq(reservas.codigo, codigo.trim().toUpperCase()))
    .limit(1);
  if (!r) return { ok: false, error: "no_encontrada" };
  if (r.origen === "web") return { ok: false, error: "es_web" };
  const filas = await db
    .update(reservas)
    .set({ estado: "cancelada" })
    .where(
      and(eq(reservas.id, r.id), eq(reservas.estado, "confirmada"), ne(reservas.origen, "web")),
    )
    .returning({ id: reservas.id });
  return filas.length > 0 ? { ok: true } : { ok: false, error: "no_confirmada" };
}

/** Reservas que ocupan noches desde `desde` (hoy por defecto): confirmadas o con hold vigente. */
export async function listarReservas(desde = hoyEnBogota()) {
  return getDb()
    .select({
      codigo: reservas.codigo,
      origen: reservas.origen,
      estado: reservas.estado,
      llegada: reservas.fechaLlegada,
      salida: reservas.fechaSalida,
      nombre: reservas.nombre,
      totalCop: reservas.totalCop,
      descuentoCop: reservas.descuentoCop,
      nota: reservas.notaAdmin,
    })
    .from(reservas)
    .where(and(reservaActiva, gt(reservas.fechaSalida, desde)))
    .orderBy(asc(reservas.fechaLlegada));
}

// ---------------------------------------------------------------------------
// Códigos de descuento
// ---------------------------------------------------------------------------

const esquemaCodigoNuevo = z
  .object({
    codigo: esquemaCodigoDescuento,
    porcentaje: z.coerce
      .number()
      .int({ error: "El porcentaje debe ser un número entero" })
      .min(1, { error: "El porcentaje va de 1 a 90" })
      .max(90, { error: "El porcentaje va de 1 a 90" }),
    validoDesde: fecha.optional(),
    validoHasta: fecha.optional(),
    estadiaDesde: fecha.optional(),
    estadiaHasta: fecha.optional(),
    usosMaximos: z.coerce.number().int().min(1, { error: "Los usos deben ser 1 o más" }).optional(),
    descripcion: z.string().trim().max(300).optional(),
  })
  .refine((c) => !c.validoDesde || !c.validoHasta || c.validoDesde <= c.validoHasta, {
    error: "La vigencia termina antes de empezar",
    path: ["validoHasta"],
  })
  .refine((c) => !c.estadiaDesde || !c.estadiaHasta || c.estadiaDesde <= c.estadiaHasta, {
    error: "El rango de estadía termina antes de empezar",
    path: ["estadiaHasta"],
  });

export type ResultadoCodigo =
  | { ok: true; codigo: string }
  | { ok: false; error: "datos_invalidos"; errores: Errores }
  | { ok: false; error: "ya_existe" };

export async function crearCodigoDescuento(entrada: unknown): Promise<ResultadoCodigo> {
  const c = esquemaCodigoNuevo.safeParse(entrada);
  if (!c.success) return { ok: false, error: "datos_invalidos", errores: errores(c.error) };
  const [fila] = await getDb()
    .insert(codigosDescuento)
    .values(c.data)
    .onConflictDoNothing({ target: codigosDescuento.codigo })
    .returning({ codigo: codigosDescuento.codigo });
  return fila ? { ok: true, codigo: fila.codigo } : { ok: false, error: "ya_existe" };
}

/** Desactiva un código. Las reservas que ya lo usaron conservan su descuento. */
export async function desactivarCodigoDescuento(codigo: string) {
  const filas = await getDb()
    .update(codigosDescuento)
    .set({ activo: false })
    .where(eq(codigosDescuento.codigo, codigo.trim().toUpperCase()))
    .returning({ id: codigosDescuento.id });
  return filas.length > 0;
}

/** Todos los códigos con sus usos actuales (reservas confirmadas o con hold vigente). */
export async function listarCodigos() {
  const db = getDb();
  const filas = await db.select().from(codigosDescuento).orderBy(asc(codigosDescuento.creadoEn));
  return Promise.all(filas.map(async (f) => ({ ...f, usos: await usosCodigo(db, f.id) })));
}

// ---------------------------------------------------------------------------
// Cabalgata
// ---------------------------------------------------------------------------

async function servicioCabalgata() {
  const [s] = await getDb()
    .select({
      id: servicios.id,
      turnos: servicios.turnos,
      capacidadTurno: servicios.capacidadTurno,
      precio: servicios.precio,
    })
    .from(servicios)
    .where(eq(servicios.slug, SLUG_CABALGATA))
    .limit(1);
  return s ?? null;
}

/** Cabalgatas de reservas activas desde `desde` (hoy por defecto), para coordinar con el aliado. */
export async function listarCabalgatas(desde = hoyEnBogota()) {
  return getDb()
    .select({
      fecha: reservas.cabalgataFecha,
      turno: reservas.cabalgataTurno,
      personas: reservas.cabalgataPersonas,
      codigo: reservas.codigo,
      estado: reservas.estado,
      nombre: reservas.nombre,
      telefono: reservas.telefono,
    })
    .from(reservas)
    .where(
      and(reservaActiva, isNotNull(reservas.cabalgataFecha), gte(reservas.cabalgataFecha, desde)),
    )
    .orderBy(asc(reservas.cabalgataFecha), asc(reservas.cabalgataTurno));
}

const esquemaCupoCabalgata = z.object({
  fecha: fecha.optional(),
  turno: z
    .string()
    .regex(/^\d{2}:\d{2}$/, { error: "El turno va como HH:MM, ej. 09:00" })
    .optional(),
  capacidad: z.coerce
    .number({ error: "La capacidad debe ser un número" })
    .int()
    .min(0, { error: "La capacidad no puede ser negativa" })
    .max(100)
    .optional(),
});

export type ResultadoCupoCabalgata =
  | { ok: true; turnos: string[]; afectadas: Awaited<ReturnType<typeof listarCabalgatas>> }
  | { ok: false; error: "datos_invalidos"; errores: Errores }
  | { ok: false; error: "sin_cabalgata" | "turno_invalido" };

/**
 * Cambia la capacidad de la cabalgata. Sin fecha, la de todos los días (por turno). Con fecha,
 * solo la de ese día (y turno, si se indica); capacidad 0 = cerrado. Las reservas que ya la
 * tienen no se tocan: se devuelven en `afectadas` para avisarles.
 */
export async function fijarCapacidadCabalgata(entrada: unknown): Promise<ResultadoCupoCabalgata> {
  const e = esquemaCupoCabalgata.safeParse(entrada);
  if (!e.success) return { ok: false, error: "datos_invalidos", errores: errores(e.error) };
  const { fecha: dia, turno, capacidad } = e.data;
  if (capacidad === undefined)
    return { ok: false, error: "datos_invalidos", errores: { capacidad: ["Indica la capacidad"] } };
  const s = await servicioCabalgata();
  if (!s) return { ok: false, error: "sin_cabalgata" };
  const todos = s.turnos.length > 0 ? s.turnos : [""];
  if (turno && !todos.includes(turno)) return { ok: false, error: "turno_invalido" };

  if (!dia) {
    await getDb()
      .update(servicios)
      .set({ capacidadTurno: capacidad })
      .where(eq(servicios.id, s.id));
    return { ok: true, turnos: todos, afectadas: [] };
  }

  const turnos = turno ? [turno] : todos;
  await getDb()
    .insert(cuposServicio)
    .values(turnos.map((t) => ({ servicioId: s.id, fecha: dia, turno: t, capacidad })))
    .onConflictDoUpdate({
      target: [cuposServicio.servicioId, cuposServicio.fecha, cuposServicio.turno],
      set: { capacidad },
    });
  const afectadas = (await listarCabalgatas(dia)).filter(
    (c) => c.fecha === dia && turnos.includes(c.turno ?? ""),
  );
  return { ok: true, turnos, afectadas };
}

/** Quita las excepciones de un día (o de un turno): vuelve a la capacidad de todos los días. */
export async function abrirCabalgata(entrada: unknown): Promise<ResultadoCupoCabalgata> {
  const e = esquemaCupoCabalgata.safeParse(entrada);
  if (!e.success || !e.data.fecha)
    return {
      ok: false,
      error: "datos_invalidos",
      errores: e.success ? { fecha: ["Indica la fecha"] } : errores(e.error),
    };
  const s = await servicioCabalgata();
  if (!s) return { ok: false, error: "sin_cabalgata" };
  const todos = s.turnos.length > 0 ? s.turnos : [""];
  const { fecha: dia, turno } = e.data;
  if (turno && !todos.includes(turno)) return { ok: false, error: "turno_invalido" };
  const turnos = turno ? [turno] : todos;
  await getDb()
    .delete(cuposServicio)
    .where(
      and(
        eq(cuposServicio.servicioId, s.id),
        eq(cuposServicio.fecha, dia),
        inArray(cuposServicio.turno, turnos),
      ),
    );
  return { ok: true, turnos, afectadas: [] };
}

/** Cambia el precio por persona. Las reservas ya hechas conservan el suyo. */
export async function fijarPrecioCabalgata(valor: unknown) {
  const v = z.coerce.number().int().min(0).max(10_000_000).safeParse(valor);
  if (!v.success) return { ok: false, error: "datos_invalidos" } as const;
  const filas = await getDb()
    .update(servicios)
    .set({ precio: v.data })
    .where(eq(servicios.slug, SLUG_CABALGATA))
    .returning({ id: servicios.id });
  return filas.length > 0
    ? ({ ok: true } as const)
    : ({ ok: false, error: "sin_cabalgata" } as const);
}

/** Capacidad y precio actuales, para mostrarlos en la terminal. */
export async function resumenCabalgata() {
  return servicioCabalgata();
}
