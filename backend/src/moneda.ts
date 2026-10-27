import { sql } from "drizzle-orm";
import { z } from "zod";
import { configuracion, getDb } from "./db";
import { diasEntre } from "./precios";

// TRM oficial publicada por la Superintendencia Financiera en datos.gov.co
// (dataset "Tasa de Cambio Representativa del Mercado- TRM", id 32sa-8pi3, actualización diaria).
// Columnas: valor (texto, COP por 1 USD), unidad, vigenciadesde, vigenciahasta (ISO, medianoche).
// El dataset publica filas con vigencia futura, por eso se filtra por la fecha de hoy en Bogotá.
const URL_TRM = "https://www.datos.gov.co/resource/32sa-8pi3.json";

const respuestaTrm = z
  .array(
    z.object({
      valor: z.coerce.number().positive(),
      vigenciadesde: z.string(),
    }),
  )
  .min(1);

export type Trm = { valor: number; fecha: string };

export function hoyEnBogota() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
}

/**
 * TRM vigente hoy, o null si datos.gov.co no responde o responde algo inesperado.
 * Para mostrar y cobrar en USD usa `trmParaCobro`, que guarda la última TRM conocida.
 * No lo llames desde páginas: consulta datos.gov.co en cada llamada.
 */
export async function obtenerTrm(): Promise<Trm | null> {
  const params = new URLSearchParams({
    $where: `vigenciadesde <= '${hoyEnBogota()}T00:00:00.000'`,
    $order: "vigenciadesde DESC",
    $limit: "1",
  });
  try {
    const res = await fetch(`${URL_TRM}?${params}`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const datos = respuestaTrm.safeParse(await res.json());
    if (!datos.success) throw new Error("respuesta con formato inesperado");
    const [fila] = datos.data;
    return { valor: fila!.valor, fecha: fila!.vigenciadesde.slice(0, 10) };
  } catch (error) {
    // Caso previsto: quien llama usa la TRM guardada. warn y no error para no abrir el overlay de Next.
    console.warn("No se pudo obtener la TRM:", error instanceof Error ? error.message : error);
    return null;
  }
}

/** Días que se acepta la última TRM guardada cuando datos.gov.co no responde. */
export const DIAS_TRM_GUARDADA = 7;

/**
 * Minutos entre consultas a datos.gov.co mientras haya una TRM guardada utilizable. Hace falta
 * porque en fines de semana y festivos la TRM vigente tiene fecha anterior a hoy.
 */
const MINUTOS_ENTRE_CONSULTAS = 60;
let ultimaConsulta = 0;

/**
 * TRM con la que se muestra y se cobra en USD. Usa la guardada en `configuracion` si es de hoy
 * o si se consultó datos.gov.co hace menos de MINUTOS_ENTRE_CONSULTAS; si no, consulta y guarda.
 * Si datos.gov.co no responde, usa la guardada mientras tenga como máximo DIAS_TRM_GUARDADA días.
 * Null si no hay ninguna utilizable: en ese caso no se ofrece PayPal.
 */
export async function trmParaCobro(): Promise<Trm | null> {
  if (!process.env.DATABASE_URL) return obtenerTrm();
  const db = getDb();
  const hoy = hoyEnBogota();
  const [fila] = await db
    .select({ valor: configuracion.trmValor, fecha: configuracion.trmFecha })
    .from(configuracion)
    .limit(1);
  const guardada =
    fila?.valor && fila.fecha && diasEntre(fila.fecha, hoy) <= DIAS_TRM_GUARDADA
      ? { valor: Number(fila.valor), fecha: fila.fecha }
      : null;
  const consultaReciente = Date.now() - ultimaConsulta < MINUTOS_ENTRE_CONSULTAS * 60_000;
  if (guardada && (guardada.fecha === hoy || consultaReciente)) return guardada;

  ultimaConsulta = Date.now();
  const trm = await obtenerTrm();
  if (!trm) return guardada;
  const valor = trm.valor.toFixed(2);
  await db
    .update(configuracion)
    .set({ trmValor: valor, trmFecha: trm.fecha })
    .where(sql`${configuracion.trmFecha} is distinct from ${trm.fecha}`);
  return { valor: Number(valor), fecha: trm.fecha };
}

/** COP → centavos de USD, redondeando hacia arriba. La TRM se usa con 2 decimales. */
export function copAUsdCentavos(cop: number, trm: number) {
  // Aritmética entera: cop · 100 · 100 / (trm · 100).
  return Math.ceil((cop * 10_000) / Math.round(trm * 100));
}

/** 12345 → "123.45" (formato de `amount.value` en PayPal). */
export function centavosAValor(centavos: number) {
  return `${Math.floor(centavos / 100)}.${String(centavos % 100).padStart(2, "0")}`;
}

/** "123.45" → 12345. Null si no es un monto con hasta 2 decimales. */
export function valorACentavos(valor: string) {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(valor);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}
