// Motor de tarifas (PLAN_DESARROLLO.md §4). Funciones puras: no tocan la BD ni el reloj.
// Única fuente de verdad del precio. Fechas como texto "YYYY-MM-DD" y aritmética en UTC,
// así el resultado no depende de la zona horaria del servidor.

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type ConfigTarifas = {
  precioBase: number;
  precioAlto: number;
  precioTemporada: number;
  precioFechaEspecial: number;
  precioPersonaExtra: number;
  maxHuespedes: number;
  huespedesIncluidos: number;
  maxAdicionales: number;
  precioAdicionalAdulto: number;
  precioAdicionalNino: number;
  precioMascota: number;
  minimoNochesPuente: number;
  nocheFestivoAlta: boolean;
};

export type Temporada = {
  nombre: string;
  fechaInicio: string; // inclusive
  fechaFin: string; // inclusive
  /** Null: usa config.precioTemporada. */
  precioNoche: number | null;
  precioPersonaExtra: number | null;
  minimoNoches: number;
};

export type AjusteFecha = {
  fecha: string;
  precio: number | null;
  /** Fecha especial: sin precio propio usa config.precioFechaEspecial. */
  especial: boolean;
  bloqueada: boolean;
};

export type DatosTarifas = {
  config: ConfigTarifas;
  temporadas: Temporada[];
  festivos: Set<string>;
  ajustes: Map<string, AjusteFecha>;
  /** Noches con una reserva confirmada o pendiente vigente. */
  nochesOcupadas: Set<string>;
};

export type TipoNoche = "base" | "alta" | "puente" | "festivo" | "temporada" | "ajuste";

/** La noche de `fecha` a `fecha + 1`. */
export type Noche = {
  fecha: string;
  tipo: TipoNoche;
  precio: number;
  precioPersonaExtra: number;
  bloqueada: boolean;
};

/** Acompañantes por encima de maxHuespedes, por edad. */
export type Adicionales = { adultos: number; ninos: number; menores: number };

export const SIN_ADICIONALES: Adicionales = { adultos: 0, ninos: 0, menores: 0 };

export function totalAdicionales(a: Adicionales) {
  return a.adultos + a.ninos + a.menores;
}

/** "6 personas" o "8 personas (6 + 2 adicionales)". */
export function textoPersonas(huespedes: number, adicionales: Adicionales = SIN_ADICIONALES) {
  const extra = totalAdicionales(adicionales);
  const total = huespedes + extra;
  const base = `${total} ${total === 1 ? "persona" : "personas"}`;
  if (extra === 0) return base;
  return `${base} (${huespedes} + ${extra} ${extra === 1 ? "adicional" : "adicionales"})`;
}

/** Una línea por tipo de adicional, ej. ["2 adultos", "1 niño de 4 a 11 años"]. */
export function detalleAdicionales(a: Adicionales) {
  return [
    a.adultos > 0 && `${a.adultos} ${a.adultos === 1 ? "adulto" : "adultos"}`,
    a.ninos > 0 && `${a.ninos} ${a.ninos === 1 ? "niño" : "niños"} de 4 a 11 años`,
    a.menores > 0 && `${a.menores} ${a.menores === 1 ? "menor" : "menores"} de 4 años`,
  ].filter((t): t is string => !!t);
}

export type Estadia = {
  llegada: string;
  salida: string;
  /** Grupo base, de 1 a maxHuespedes. */
  huespedes: number;
  /** Solo con el grupo base completo (huespedes = maxHuespedes). */
  adicionales?: Adicionales;
  /** No cuentan como huéspedes; se cobran por mascota y por noche. */
  mascotas?: number;
};

export type Cotizacion = {
  ok: true;
  noches: Noche[];
  personasExtra: number;
  subtotal: number;
  extraPersonas: number;
  adicionales: Adicionales;
  /** Por noche; los precios de adicionales no cambian con la temporada. */
  precioAdicionalAdulto: number;
  precioAdicionalNino: number;
  /** Adultos y niños adicionales por todas las noches. */
  extraAdicionales: number;
  mascotas: number;
  /** Por mascota y por noche. */
  precioMascota: number;
  extraMascotas: number;
  total: number;
  moneda: "COP";
};

export type ErrorCotizacion = {
  ok: false;
  error:
    | "fechas_invalidas"
    | "huespedes_invalidos"
    | "adicionales_invalidos"
    | "mascotas_invalidas"
    | "minimo_noches"
    | "no_disponible";
  minimo?: number;
  fecha?: string;
};

export type EstadoDia = "disponible" | "ocupado" | "bloqueado" | "pasado";

export type DiaCalendario = {
  fecha: string;
  precio: number;
  tipo: TipoNoche;
  estado: EstadoDia;
  festivo: boolean;
  mejorPrecio: boolean;
};

/** Estadía máxima aceptada en una reserva en línea. */
export const MAXIMO_NOCHES = 30;

// ---------------------------------------------------------------------------
// Fechas
// ---------------------------------------------------------------------------

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

function aUtc(fecha: string) {
  const [a = 0, m = 1, d = 1] = fecha.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d));
}

function aTexto(fecha: Date) {
  return fecha.toISOString().slice(0, 10);
}

export function esFechaValida(fecha: string) {
  return RE_FECHA.test(fecha) && aTexto(aUtc(fecha)) === fecha;
}

export function sumarDias(fecha: string, dias: number) {
  const d = aUtc(fecha);
  d.setUTCDate(d.getUTCDate() + dias);
  return aTexto(d);
}

export function diasEntre(desde: string, hasta: string) {
  return Math.round((aUtc(hasta).getTime() - aUtc(desde).getTime()) / 86_400_000);
}

/** 0 = domingo … 6 = sábado. */
export function diaSemana(fecha: string) {
  return aUtc(fecha).getUTCDay();
}

// ---------------------------------------------------------------------------
// Clasificación de una noche
// ---------------------------------------------------------------------------

export function clasificarNoche(fecha: string, datos: DatosTarifas): Noche {
  const { config, festivos } = datos;
  const temporada = datos.temporadas.find((t) => t.fechaInicio <= fecha && fecha <= t.fechaFin);
  const ajuste = datos.ajustes.get(fecha);
  const precioPersonaExtra = temporada?.precioPersonaExtra ?? config.precioPersonaExtra;

  let tipo: TipoNoche;
  let precio: number;
  const dia = diaSemana(fecha);

  if (ajuste && (ajuste.precio !== null || ajuste.especial)) {
    tipo = "ajuste";
    precio = ajuste.precio ?? config.precioFechaEspecial;
  } else if (temporada) {
    tipo = "temporada";
    precio = temporada.precioNoche ?? config.precioTemporada;
  } else if (dia === 5 || dia === 6) {
    tipo = "alta";
    precio = config.precioAlto;
  } else if (festivos.has(sumarDias(fecha, 1))) {
    tipo = "puente";
    precio = config.precioAlto;
  } else if (config.nocheFestivoAlta && festivos.has(fecha)) {
    tipo = "festivo";
    precio = config.precioAlto;
  } else {
    tipo = "base";
    precio = config.precioBase;
  }

  return { fecha, tipo, precio, precioPersonaExtra, bloqueada: ajuste?.bloqueada ?? false };
}

// ---------------------------------------------------------------------------
// Cotización de una estadía
// ---------------------------------------------------------------------------

export function cotizar(
  estadia: Estadia,
  datos: DatosTarifas,
  hoy: string,
): Cotizacion | ErrorCotizacion {
  const { llegada, salida, huespedes, adicionales = SIN_ADICIONALES, mascotas = 0 } = estadia;
  const { config } = datos;

  if (!esFechaValida(llegada) || !esFechaValida(salida) || llegada < hoy) {
    return { ok: false, error: "fechas_invalidas" };
  }
  const cantidad = diasEntre(llegada, salida);
  if (cantidad < 1 || cantidad > MAXIMO_NOCHES) return { ok: false, error: "fechas_invalidas" };

  if (!Number.isInteger(huespedes) || huespedes < 1 || huespedes > config.maxHuespedes) {
    return { ok: false, error: "huespedes_invalidos" };
  }
  const cantidades = [adicionales.adultos, adicionales.ninos, adicionales.menores];
  const adicionalesTotal = totalAdicionales(adicionales);
  if (
    cantidades.some((c) => !Number.isInteger(c) || c < 0) ||
    adicionalesTotal > config.maxAdicionales ||
    (adicionalesTotal > 0 && huespedes < config.maxHuespedes)
  ) {
    return { ok: false, error: "adicionales_invalidos" };
  }
  if (!Number.isInteger(mascotas) || mascotas < 0)
    return { ok: false, error: "mascotas_invalidas" };

  const noches: Noche[] = [];
  let minimo = 1;
  for (let i = 0; i < cantidad; i++) {
    const noche = clasificarNoche(sumarDias(llegada, i), datos);
    if (noche.bloqueada || datos.nochesOcupadas.has(noche.fecha)) {
      return { ok: false, error: "no_disponible", fecha: noche.fecha };
    }
    if (noche.tipo === "puente") minimo = Math.max(minimo, config.minimoNochesPuente);
    const temporada = datos.temporadas.find(
      (t) => t.fechaInicio <= noche.fecha && noche.fecha <= t.fechaFin,
    );
    if (temporada) minimo = Math.max(minimo, temporada.minimoNoches);
    noches.push(noche);
  }

  // El mínimo se exige sobre el total de noches de la estadía.
  if (cantidad < minimo) return { ok: false, error: "minimo_noches", minimo };

  const personasExtra = Math.max(0, huespedes - config.huespedesIncluidos);
  const subtotal = noches.reduce((s, n) => s + n.precio, 0);
  const extraPersonas = noches.reduce((s, n) => s + personasExtra * n.precioPersonaExtra, 0);
  const extraAdicionales =
    cantidad *
    (adicionales.adultos * config.precioAdicionalAdulto +
      adicionales.ninos * config.precioAdicionalNino);
  const extraMascotas = cantidad * mascotas * config.precioMascota;

  return {
    ok: true,
    noches,
    personasExtra,
    subtotal,
    extraPersonas,
    adicionales,
    precioAdicionalAdulto: config.precioAdicionalAdulto,
    precioAdicionalNino: config.precioAdicionalNino,
    extraAdicionales,
    mascotas,
    precioMascota: config.precioMascota,
    extraMascotas,
    total: subtotal + extraPersonas + extraAdicionales + extraMascotas,
    moneda: "COP",
  };
}

// ---------------------------------------------------------------------------
// Calendario de un mes
// ---------------------------------------------------------------------------

export function esMesValido(mes: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(mes);
}

export function calendarioMes(mes: string, datos: DatosTarifas, hoy: string): DiaCalendario[] {
  if (!esMesValido(mes)) throw new Error(`Mes inválido: ${mes}`);
  const [a = 0, m = 1] = mes.split("-").map(Number);
  const totalDias = new Date(Date.UTC(a, m, 0)).getUTCDate();

  const dias = Array.from({ length: totalDias }, (_, i): DiaCalendario => {
    const fecha = `${mes}-${String(i + 1).padStart(2, "0")}`;
    const noche = clasificarNoche(fecha, datos);
    const estado: EstadoDia =
      fecha < hoy
        ? "pasado"
        : datos.nochesOcupadas.has(fecha)
          ? "ocupado"
          : noche.bloqueada
            ? "bloqueado"
            : "disponible";
    return {
      fecha,
      precio: noche.precio,
      tipo: noche.tipo,
      estado,
      festivo: datos.festivos.has(fecha),
      mejorPrecio: false,
    };
  });

  const precios = dias.filter((d) => d.estado === "disponible").map((d) => d.precio);
  const min = Math.min(...precios);
  const max = Math.max(...precios);
  if (precios.length > 0 && min < max) {
    for (const d of dias) d.mejorPrecio = d.estado === "disponible" && d.precio === min;
  }
  return dias;
}

// ---------------------------------------------------------------------------
// Festivos de Colombia (Ley 51 de 1983 "Ley Emiliani" y fechas que dependen de Pascua)
// ---------------------------------------------------------------------------

/** Domingo de Pascua (algoritmo de Meeus/Jones/Butcher). */
function pascua(anio: number) {
  const a = anio % 19;
  const b = Math.floor(anio / 100);
  const c = anio % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return aTexto(new Date(Date.UTC(anio, mes - 1, dia)));
}

/** Traslada al lunes siguiente si no cae en lunes. */
function aLunes(fecha: string) {
  const dia = diaSemana(fecha);
  return dia === 1 ? fecha : sumarDias(fecha, (8 - dia) % 7);
}

export function calcularFestivos(anio: number): { fecha: string; nombre: string }[] {
  const f = (mes: number, dia: number) =>
    `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  const p = pascua(anio);

  const festivos = [
    // Fijos
    { fecha: f(1, 1), nombre: "Año Nuevo" },
    { fecha: f(5, 1), nombre: "Día del Trabajo" },
    { fecha: f(7, 20), nombre: "Día de la Independencia" },
    { fecha: f(8, 7), nombre: "Batalla de Boyacá" },
    { fecha: f(12, 8), nombre: "Inmaculada Concepción" },
    { fecha: f(12, 25), nombre: "Navidad" },
    // Trasladables al lunes
    { fecha: aLunes(f(1, 6)), nombre: "Reyes Magos" },
    { fecha: aLunes(f(3, 19)), nombre: "Día de San José" },
    { fecha: aLunes(f(6, 29)), nombre: "San Pedro y San Pablo" },
    { fecha: aLunes(f(7, 9)), nombre: "Día de la Virgen de Chiquinquirá" },
    { fecha: aLunes(f(8, 15)), nombre: "Asunción de la Virgen" },
    { fecha: aLunes(f(10, 12)), nombre: "Día de la Raza" },
    { fecha: aLunes(f(11, 1)), nombre: "Todos los Santos" },
    { fecha: aLunes(f(11, 11)), nombre: "Independencia de Cartagena" },
    // Dependen de Pascua
    { fecha: sumarDias(p, -3), nombre: "Jueves Santo" },
    { fecha: sumarDias(p, -2), nombre: "Viernes Santo" },
    { fecha: sumarDias(p, 43), nombre: "Ascensión del Señor" },
    { fecha: sumarDias(p, 64), nombre: "Corpus Christi" },
    { fecha: sumarDias(p, 71), nombre: "Sagrado Corazón" },
  ];
  return festivos.sort((x, y) => x.fecha.localeCompare(y.fecha));
}

// ---------------------------------------------------------------------------
// Temporada alta y fechas especiales (se cargan en `temporadas` y `ajustes_fecha` con la semilla)
// ---------------------------------------------------------------------------

/** El enésimo `dia` (0 = domingo … 6 = sábado) de un mes. */
function enesimoDia(anio: number, mes: number, dia: number, n: number) {
  const primero = `${anio}-${String(mes).padStart(2, "0")}-01`;
  return sumarDias(primero, ((dia - diaSemana(primero) + 7) % 7) + 7 * (n - 1));
}

/** Rangos de noches (ambas inclusive). Fin de año cruza al año siguiente. */
export function calcularTemporadasAltas(anio: number): Temporada[] {
  const p = pascua(anio);
  const base = { precioNoche: null, precioPersonaExtra: null, minimoNoches: 2 };
  return [
    // Del viernes anterior a Domingo de Ramos a la noche del Sábado Santo (salida el domingo de Pascua).
    {
      nombre: `Semana Santa ${anio}`,
      fechaInicio: sumarDias(p, -9),
      fechaFin: sumarDias(p, -1),
      ...base,
    },
    {
      nombre: `Mitad de año ${anio}`,
      fechaInicio: `${anio}-06-15`,
      fechaFin: `${anio}-07-15`,
      ...base,
    },
    // Incluye la Feria de Manizales (primera quincena de enero).
    {
      nombre: `Fin de año ${anio}`,
      fechaInicio: `${anio}-12-15`,
      fechaFin: `${anio + 1}-01-15`,
      ...base,
    },
  ];
}

/** Noches que se cobran a precioFechaEspecial. */
export function calcularFechasEspeciales(anio: number): { fecha: string; nombre: string }[] {
  const f = (mes: number, dia: number) =>
    `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  const especiales = [
    { fecha: f(2, 14), nombre: "San Valentín" },
    { fecha: enesimoDia(anio, 5, 0, 2), nombre: "Día de la Madre" },
    { fecha: enesimoDia(anio, 6, 0, 3), nombre: "Día del Padre" },
    { fecha: enesimoDia(anio, 9, 6, 3), nombre: "Amor y Amistad" },
    { fecha: f(12, 7), nombre: "Noche de Velitas" },
    { fecha: f(12, 24), nombre: "Nochebuena" },
    { fecha: f(12, 31), nombre: "Fin de año" },
  ];
  return especiales.sort((x, y) => x.fecha.localeCompare(y.fecha));
}
