export type Moneda = "COP" | "USD";

const cop = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/**
 * Formatea un monto guardado en COP en la moneda elegida (REGLAS_WEB §11).
 * 390000 → "$390.000 COP" · en USD con TRM 3900 → "≈ $100 USD".
 * Sin TRM no hay conversión posible y se muestra en COP.
 */
export function formatoPrecio(montoCop: number, moneda: Moneda, trm: number | null) {
  if (moneda === "USD" && trm) {
    return `≈ ${usd.format(Math.round(montoCop / trm))} USD`;
  }
  // Intl agrega un espacio tras "$" que se quita.
  return `${cop.format(montoCop).replace(/\s/g, "")} COP`;
}

/** Versión corta para el calendario: 390000 → "390k" · en USD → "$100". */
export function formatoPrecioCorto(montoCop: number, moneda: Moneda, trm: number | null) {
  if (moneda === "USD" && trm) return usd.format(Math.round(montoCop / trm));
  const miles = montoCop / 1000;
  return `${Number.isInteger(miles) ? miles : miles.toFixed(1).replace(".", ",")}k`;
}

/**
 * "15:00:00" (columna time de Postgres) → "3:00 p. m."
 * A mano y no con toLocaleTimeString: Node y cada navegador usan espacios distintos (normal,
 * no separable o estrecho) antes de "p. m.", y eso rompe la hidratación.
 */
export function formatoHora(hora: string) {
  const [h = 0, m = 0] = hora.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "a. m." : "p. m."}`;
}

function fechaUtc(fecha: string) {
  const [a = 0, m = 1, d = 1] = fecha.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d));
}

/** "2026-10-21" → "21 de octubre de 2026" */
export function formatoFecha(fecha: string) {
  return fechaUtc(fecha).toLocaleDateString("es-CO", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "2026-10-17" → "sábado, 17 de octubre" */
export function formatoFechaDia(fecha: string) {
  return fechaUtc(fecha).toLocaleDateString("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

/** "2026-10-17" → "sáb. 17 oct." */
export function formatoFechaCorta(fecha: string) {
  return fechaUtc(fecha).toLocaleDateString("es-CO", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

// ---------------------------------------------------------------------------
// Servicios
// ---------------------------------------------------------------------------

const UNIDADES = {
  persona: ["persona", "personas"],
  pareja: ["pareja", "parejas"],
  trayecto: ["trayecto", "trayectos"],
  unidad: ["unidad", "unidades"],
} as const;

type Unidad = keyof typeof UNIDADES;

/** (2, "persona") → "2 personas" */
export function cantidadTexto(n: number, unidad: Unidad) {
  return `${n} ${UNIDADES[unidad][n === 1 ? 0 : 1]}`;
}

export function unidadSingular(unidad: Unidad) {
  return UNIDADES[unidad][0];
}

/** Fecha y turno de un servicio: "sáb. 24 oct. · 9:00 a. m." */
export function cuandoTexto(fecha: string | null, turno: string | null) {
  if (!fecha) return "Fecha por coordinar";
  return `${formatoFechaCorta(fecha)}${turno ? ` · ${formatoHora(turno)}` : ""}`;
}

/** Mensaje para una línea del carrito que el servidor marcó con problema. */
export function problemaLinea(estado: string, disponible?: number) {
  switch (estado) {
    case "ok":
      return null;
    case "agotado":
      return "Ya no quedan cupos para esta fecha.";
    case "sin_cupos_suficientes":
      return `Solo ${disponible === 1 ? "queda 1 cupo" : `quedan ${disponible} cupos`}. Ajusta la cantidad.`;
    case "fuera_de_estadia":
      return "Esta fecha está fuera de tu estadía.";
    case "fecha_invalida":
      return "La fecha ya pasó. Elige otra.";
    case "cantidad_invalida":
      return "Revisa la cantidad.";
    default:
      return "Este servicio ya no está disponible.";
  }
}

/** "2026-10" → "octubre de 2026" */
export function formatoMes(mes: string) {
  return fechaUtc(`${mes}-01`).toLocaleDateString("es-CO", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
