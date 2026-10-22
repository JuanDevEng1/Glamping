import { z } from "zod";

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
 * Solo para mostrar precios aproximados en USD; un cobro en USD debe guardar la TRM en la reserva.
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
    console.error("No se pudo obtener la TRM:", error instanceof Error ? error.message : error);
    return null;
  }
}
