import { describe, expect, it } from "vitest";
import {
  agregarCabalgata,
  aplicarDescuento,
  calcularFechasEspeciales,
  calcularFestivos,
  calcularTemporadasAltas,
  calendarioMes,
  clasificarNoche,
  cotizar,
  opcionesCabalgata,
  personasCabalgata,
  turnoEnEstadia,
  type AjusteFecha,
  type CodigoDescuento,
  type Cotizacion,
  type DatosCabalgata,
  type ConfigTarifas,
  type DatosTarifas,
  type Temporada,
} from "../src/precios";

// Referencias de calendario (2026): el 1 de noviembre es domingo.
// 6 nov viernes · 7 sábado · 10 martes · 14 sábado · 15 domingo · 16 lunes festivo (Independencia de Cartagena)
// 13 dic domingo · 18 dic viernes · 30 dic miércoles.

const HOY = "2026-10-21";

const config: ConfigTarifas = {
  precioBase: 280_000,
  precioAlto: 350_000,
  precioTemporada: 560_000,
  precioFechaEspecial: 650_000,
  precioPersonaExtra: 60_000,
  maxHuespedes: 6,
  huespedesIncluidos: 2,
  maxAdicionales: 4,
  precioAdicionalAdulto: 90_000,
  precioAdicionalNino: 60_000,
  precioMascota: 50_000,
  minimoNochesPuente: 1,
  nocheFestivoAlta: false,
};

const finDeAnio: Temporada = {
  nombre: "Fin de año",
  fechaInicio: "2026-12-15",
  fechaFin: "2027-01-15",
  precioNoche: 450_000,
  precioPersonaExtra: 80_000,
  minimoNoches: 2,
};

function datos(
  cambios: Partial<Omit<DatosTarifas, "config">> & { config?: Partial<ConfigTarifas> } = {},
): DatosTarifas {
  return {
    config: { ...config, ...cambios.config },
    temporadas: cambios.temporadas ?? [finDeAnio],
    festivos:
      cambios.festivos ??
      new Set(["2026-11-02", "2026-11-16", "2026-12-08", "2026-12-25", "2027-01-01", "2027-01-11"]),
    ajustes: cambios.ajustes ?? new Map<string, AjusteFecha>(),
    nochesOcupadas: cambios.nochesOcupadas ?? new Set<string>(),
  };
}

const estadia = (llegada: string, salida: string, huespedes = 2) => ({
  llegada,
  salida,
  huespedes,
});

describe("clasificarNoche", () => {
  it("entre semana (domingo a jueves) usa la tarifa base", () => {
    expect(clasificarNoche("2026-11-10", datos())).toMatchObject({
      tipo: "base",
      precio: 280_000,
      bloqueada: false,
    });
  });

  it("viernes y sábado usan la tarifa alta", () => {
    expect(clasificarNoche("2026-11-06", datos())).toMatchObject({ tipo: "alta", precio: 350_000 });
    expect(clasificarNoche("2026-11-07", datos())).toMatchObject({ tipo: "alta", precio: 350_000 });
  });

  it("la noche previa a un festivo es puente con tarifa alta", () => {
    expect(clasificarNoche("2026-11-15", datos())).toMatchObject({
      tipo: "puente",
      precio: 350_000,
    });
  });

  it("la noche del propio festivo es base por defecto", () => {
    expect(clasificarNoche("2026-11-16", datos())).toMatchObject({ tipo: "base", precio: 280_000 });
  });

  it("la noche del propio festivo es alta si nocheFestivoAlta está activo", () => {
    const d = datos({ config: { nocheFestivoAlta: true } });
    expect(clasificarNoche("2026-11-16", d)).toMatchObject({ tipo: "festivo", precio: 350_000 });
  });

  it("la temporada gana sobre fin de semana y usa su valor por persona extra", () => {
    expect(clasificarNoche("2026-12-18", datos())).toMatchObject({
      tipo: "temporada",
      precio: 450_000,
      precioPersonaExtra: 80_000,
    });
  });

  it("la temporada sin valor por persona extra propio usa el de la configuración", () => {
    const d = datos({ temporadas: [{ ...finDeAnio, precioPersonaExtra: null }] });
    expect(clasificarNoche("2026-12-18", d)).toMatchObject({ precioPersonaExtra: 60_000 });
  });

  it("un ajuste de precio gana sobre la temporada", () => {
    const d = datos({
      ajustes: new Map([
        ["2026-12-24", { fecha: "2026-12-24", precio: 600_000, especial: false, bloqueada: false }],
      ]),
    });
    expect(clasificarNoche("2026-12-24", d)).toMatchObject({ tipo: "ajuste", precio: 600_000 });
  });

  it("una fecha bloqueada queda marcada como bloqueada", () => {
    const d = datos({
      ajustes: new Map([
        ["2026-11-20", { fecha: "2026-11-20", precio: null, especial: false, bloqueada: true }],
      ]),
    });
    expect(clasificarNoche("2026-11-20", d)).toMatchObject({ bloqueada: true });
  });
});

describe("cotizar", () => {
  it("2 noches entre semana para 2 personas", () => {
    const r = cotizar(estadia("2026-11-10", "2026-11-12"), datos(), HOY);
    expect(r).toMatchObject({
      ok: true,
      subtotal: 560_000,
      extraPersonas: 0,
      total: 560_000,
      moneda: "COP",
    });
    if (r.ok) expect(r.noches.map((n) => n.fecha)).toEqual(["2026-11-10", "2026-11-11"]);
  });

  it("fin de semana: viernes y sábado con tarifa alta", () => {
    expect(cotizar(estadia("2026-11-06", "2026-11-08"), datos(), HOY)).toMatchObject({
      ok: true,
      total: 700_000,
    });
  });

  it("puente con lunes festivo: sábado alta, domingo puente, lunes base", () => {
    const r = cotizar(estadia("2026-11-14", "2026-11-17"), datos(), HOY);
    expect(r).toMatchObject({ ok: true, total: 980_000 });
    if (r.ok) expect(r.noches.map((n) => n.tipo)).toEqual(["alta", "puente", "base"]);
  });

  it("puente con la noche del festivo en tarifa alta", () => {
    const d = datos({ config: { nocheFestivoAlta: true } });
    expect(cotizar(estadia("2026-11-14", "2026-11-17"), d, HOY)).toMatchObject({
      ok: true,
      total: 1_050_000,
    });
  });

  it("6 personas: 4 extra por noche", () => {
    expect(cotizar(estadia("2026-11-10", "2026-11-12", 6), datos(), HOY)).toMatchObject({
      ok: true,
      subtotal: 560_000,
      extraPersonas: 480_000, // 4 × 60.000 × 2 noches
      total: 1_040_000,
    });
  });

  it("6 personas en temporada usan el valor extra de la temporada", () => {
    expect(cotizar(estadia("2026-12-18", "2026-12-20", 6), datos(), HOY)).toMatchObject({
      ok: true,
      subtotal: 900_000,
      extraPersonas: 640_000, // 4 × 80.000 × 2 noches
      total: 1_540_000,
    });
  });

  it("estadía que entra a una temporada combina tarifas por noche", () => {
    const r = cotizar(estadia("2026-12-13", "2026-12-17"), datos(), HOY);
    expect(r).toMatchObject({ ok: true, total: 1_460_000 }); // 280 + 280 + 450 + 450
    if (r.ok)
      expect(r.noches.map((n) => n.tipo)).toEqual(["base", "base", "temporada", "temporada"]);
  });

  it("ajuste de precio dentro de la temporada", () => {
    const d = datos({
      ajustes: new Map([
        ["2026-12-24", { fecha: "2026-12-24", precio: 600_000, especial: false, bloqueada: false }],
      ]),
    });
    expect(cotizar(estadia("2026-12-23", "2026-12-25"), d, HOY)).toMatchObject({
      ok: true,
      total: 1_050_000,
    });
  });

  it("cambio de año: 30 dic → 2 ene", () => {
    const r = cotizar(estadia("2026-12-30", "2027-01-02"), datos(), HOY);
    expect(r).toMatchObject({ ok: true, total: 1_350_000 });
    if (r.ok)
      expect(r.noches.map((n) => n.fecha)).toEqual(["2026-12-30", "2026-12-31", "2027-01-01"]);
  });

  it("cambio de año sin temporada: 31 dic es puente (1 ene festivo), 1 ene viernes alta", () => {
    const r = cotizar(estadia("2026-12-31", "2027-01-02"), datos({ temporadas: [] }), HOY);
    if (!r.ok) throw new Error(r.error);
    expect(r.noches.map((n) => n.tipo)).toEqual(["puente", "alta"]);
  });

  it("mínimo de noches en temporada", () => {
    expect(cotizar(estadia("2026-12-15", "2026-12-16"), datos(), HOY)).toMatchObject({
      ok: false,
      error: "minimo_noches",
      minimo: 2,
    });
  });

  it("mínimo de noches en puente", () => {
    const d = datos({ config: { minimoNochesPuente: 2 } });
    expect(cotizar(estadia("2026-11-15", "2026-11-16"), d, HOY)).toMatchObject({
      ok: false,
      error: "minimo_noches",
      minimo: 2,
    });
    expect(cotizar(estadia("2026-11-14", "2026-11-16"), d, HOY)).toMatchObject({ ok: true });
  });

  it("0 noches o salida antes de la llegada", () => {
    expect(cotizar(estadia("2026-11-10", "2026-11-10"), datos(), HOY)).toMatchObject({
      ok: false,
      error: "fechas_invalidas",
    });
    expect(cotizar(estadia("2026-11-12", "2026-11-10"), datos(), HOY)).toMatchObject({
      ok: false,
      error: "fechas_invalidas",
    });
  });

  it("llegada en el pasado o fecha mal escrita", () => {
    expect(cotizar(estadia("2026-10-20", "2026-10-22"), datos(), HOY)).toMatchObject({
      ok: false,
      error: "fechas_invalidas",
    });
    expect(cotizar(estadia("2026-13-01", "2026-13-03"), datos(), HOY)).toMatchObject({
      ok: false,
      error: "fechas_invalidas",
    });
  });

  it("llegar hoy está permitido", () => {
    expect(cotizar(estadia(HOY, "2026-10-22"), datos(), HOY)).toMatchObject({ ok: true });
  });

  it("huéspedes fuera de 1 a 6", () => {
    expect(cotizar(estadia("2026-11-10", "2026-11-12", 7), datos(), HOY)).toMatchObject({
      ok: false,
      error: "huespedes_invalidos",
    });
    expect(cotizar(estadia("2026-11-10", "2026-11-12", 0), datos(), HOY)).toMatchObject({
      ok: false,
      error: "huespedes_invalidos",
    });
    expect(cotizar(estadia("2026-11-10", "2026-11-12", 2.5), datos(), HOY)).toMatchObject({
      ok: false,
      error: "huespedes_invalidos",
    });
  });

  it("1 persona paga lo mismo que 2", () => {
    expect(cotizar(estadia("2026-11-10", "2026-11-12", 1), datos(), HOY)).toMatchObject({
      ok: true,
      total: 560_000,
    });
  });

  it("no se puede cruzar una fecha bloqueada", () => {
    const d = datos({
      ajustes: new Map([
        ["2026-11-20", { fecha: "2026-11-20", precio: null, especial: false, bloqueada: true }],
      ]),
    });
    expect(cotizar(estadia("2026-11-19", "2026-11-21"), d, HOY)).toMatchObject({
      ok: false,
      error: "no_disponible",
      fecha: "2026-11-20",
    });
  });

  it("no se puede cruzar una noche ocupada", () => {
    const d = datos({ nochesOcupadas: new Set(["2026-11-11"]) });
    expect(cotizar(estadia("2026-11-10", "2026-11-12"), d, HOY)).toMatchObject({
      ok: false,
      error: "no_disponible",
      fecha: "2026-11-11",
    });
  });

  it("sí se puede salir el día en que empieza una noche ocupada", () => {
    const d = datos({ nochesOcupadas: new Set(["2026-11-11"]) });
    expect(cotizar(estadia("2026-11-10", "2026-11-11"), d, HOY)).toMatchObject({
      ok: true,
      total: 280_000,
    });
  });
});

describe("temporada alta y fecha especial", () => {
  it("una temporada sin precio propio usa precioTemporada", () => {
    const d = datos({ temporadas: [{ ...finDeAnio, precioNoche: null }] });
    expect(clasificarNoche("2026-12-18", d)).toMatchObject({ tipo: "temporada", precio: 560_000 });
  });

  it("una fecha especial sin precio propio usa precioFechaEspecial y gana sobre la temporada", () => {
    const d = datos({
      ajustes: new Map([
        ["2026-12-24", { fecha: "2026-12-24", precio: null, especial: true, bloqueada: false }],
      ]),
    });
    expect(clasificarNoche("2026-12-24", d)).toMatchObject({ tipo: "ajuste", precio: 650_000 });
  });

  it("un ajuste sin precio ni marca de especial no cambia la tarifa", () => {
    const d = datos({
      ajustes: new Map([
        ["2026-11-10", { fecha: "2026-11-10", precio: null, especial: false, bloqueada: false }],
      ]),
    });
    expect(clasificarNoche("2026-11-10", d)).toMatchObject({ tipo: "base", precio: 280_000 });
  });
});

describe("acompañantes adicionales", () => {
  const con = (adultos: number, ninos: number, menores: number, huespedes = 6) => ({
    ...estadia("2026-11-10", "2026-11-12", huespedes),
    adicionales: { adultos, ninos, menores },
  });

  it("6 personas + 1 adulto, 1 niño y 1 menor por 2 noches", () => {
    const r = cotizar(con(1, 1, 1), datos(), HOY);
    // 2 noches × 280 000 + 4 extra × 60 000 × 2 + (90 000 + 60 000) × 2; el menor no paga.
    expect(r).toMatchObject({
      ok: true,
      subtotal: 560_000,
      extraPersonas: 480_000,
      extraAdicionales: 300_000,
      total: 1_340_000,
      adicionales: { adultos: 1, ninos: 1, menores: 1 },
    });
  });

  it("el precio de los adicionales no cambia en temporada", () => {
    const r = cotizar(
      { ...con(2, 0, 0), llegada: "2026-12-16", salida: "2026-12-18" },
      datos(),
      HOY,
    );
    expect(r).toMatchObject({ ok: true, extraAdicionales: 2 * 2 * 90_000 });
  });

  it("los menores de 4 años cuentan para el máximo", () => {
    expect(cotizar(con(2, 0, 2), datos(), HOY)).toMatchObject({ ok: true });
    expect(cotizar(con(2, 1, 2), datos(), HOY)).toEqual({
      ok: false,
      error: "adicionales_invalidos",
    });
  });

  it("solo se aceptan con el grupo base completo", () => {
    expect(cotizar(con(1, 0, 0, 5), datos(), HOY)).toEqual({
      ok: false,
      error: "adicionales_invalidos",
    });
  });

  it("cantidades negativas o con decimales no se aceptan", () => {
    expect(cotizar(con(-1, 0, 0), datos(), HOY)).toMatchObject({ error: "adicionales_invalidos" });
    expect(cotizar(con(1.5, 0, 0), datos(), HOY)).toMatchObject({ error: "adicionales_invalidos" });
  });

  it("sin adicionales el total no cambia", () => {
    expect(cotizar(con(0, 0, 0), datos(), HOY)).toMatchObject({ extraAdicionales: 0 });
  });
});

describe("calendarioMes", () => {
  it("devuelve todos los días del mes con precio, tipo y estado", () => {
    const dias = calendarioMes("2026-10", datos({ nochesOcupadas: new Set(["2026-10-27"]) }), HOY);
    expect(dias).toHaveLength(31);
    expect(dias[0]).toMatchObject({ fecha: "2026-10-01" });
    expect(dias.find((d) => d.fecha === "2026-10-20")).toMatchObject({ estado: "pasado" });
    expect(dias.find((d) => d.fecha === "2026-10-21")).toMatchObject({
      estado: "disponible",
      precio: 280_000,
    });
    expect(dias.find((d) => d.fecha === "2026-10-23")).toMatchObject({
      estado: "disponible",
      tipo: "alta",
    });
    expect(dias.find((d) => d.fecha === "2026-10-27")).toMatchObject({ estado: "ocupado" });
  });

  it("marca bloqueados y festivos", () => {
    const d = datos({
      ajustes: new Map([
        ["2026-11-20", { fecha: "2026-11-20", precio: null, especial: false, bloqueada: true }],
      ]),
    });
    const dias = calendarioMes("2026-11", d, HOY);
    expect(dias).toHaveLength(30);
    expect(dias.find((x) => x.fecha === "2026-11-20")).toMatchObject({ estado: "bloqueado" });
    expect(dias.find((x) => x.fecha === "2026-11-16")).toMatchObject({ festivo: true });
    expect(dias.find((x) => x.fecha === "2026-11-17")).toMatchObject({ festivo: false });
  });

  it("mejorPrecio marca los días disponibles más baratos del mes", () => {
    const dias = calendarioMes("2026-11", datos(), HOY);
    expect(dias.find((x) => x.fecha === "2026-11-10")).toMatchObject({ mejorPrecio: true });
    expect(dias.find((x) => x.fecha === "2026-11-06")).toMatchObject({ mejorPrecio: false });
  });

  it("si todos los días cuestan lo mismo, ninguno es mejor precio", () => {
    const d = datos({ config: { precioAlto: 280_000 } });
    expect(calendarioMes("2026-11", d, HOY).some((x) => x.mejorPrecio)).toBe(false);
  });

  it("febrero de 2028 (bisiesto) tiene 29 días", () => {
    expect(calendarioMes("2028-02", datos(), HOY)).toHaveLength(29);
  });
});

describe("calcularFestivos", () => {
  // Fuente: festivos.com.co y date.nager.at (coinciden). Incluye Virgen de Chiquinquirá (trasladable).
  it("2026", () => {
    expect(calcularFestivos(2026).map((f) => f.fecha)).toEqual([
      "2026-01-01",
      "2026-01-12",
      "2026-03-23",
      "2026-04-02",
      "2026-04-03",
      "2026-05-01",
      "2026-05-18",
      "2026-06-08",
      "2026-06-15",
      "2026-06-29",
      "2026-07-13",
      "2026-07-20",
      "2026-08-07",
      "2026-08-17",
      "2026-10-12",
      "2026-11-02",
      "2026-11-16",
      "2026-12-08",
      "2026-12-25",
    ]);
  });

  it("2027", () => {
    expect(calcularFestivos(2027).map((f) => f.fecha)).toEqual([
      "2027-01-01",
      "2027-01-11",
      "2027-03-22",
      "2027-03-25",
      "2027-03-26",
      "2027-05-01",
      "2027-05-10",
      "2027-05-31",
      "2027-06-07",
      "2027-07-05",
      "2027-07-12",
      "2027-07-20",
      "2027-08-07",
      "2027-08-16",
      "2027-10-18",
      "2027-11-01",
      "2027-11-15",
      "2027-12-08",
      "2027-12-25",
    ]);
  });

  it("cada festivo tiene nombre", () => {
    expect(calcularFestivos(2026).every((f) => f.nombre.length > 0)).toBe(true);
  });
});

describe("códigos de descuento", () => {
  const codigo = (cambios: Partial<CodigoDescuento> = {}): CodigoDescuento => ({
    codigo: "PROMO15",
    porcentaje: 15,
    activo: true,
    validoDesde: null,
    validoHasta: null,
    estadiaDesde: null,
    estadiaHasta: null,
    usosMaximos: null,
    usos: 0,
    ...cambios,
  });

  // 10 y 11 de noviembre, entre semana: 2 × 280 000.
  const base = () => {
    const r = cotizar(estadia("2026-11-10", "2026-11-12"), datos(), HOY);
    if (!r.ok) throw new Error(r.error);
    return r;
  };

  it("sin código la cotización no trae descuento", () => {
    expect(base()).toMatchObject({ descuento: null, totalSinDescuento: 560_000, total: 560_000 });
  });

  it("aplica el porcentaje sobre el total", () => {
    expect(aplicarDescuento(base(), codigo(), HOY)).toMatchObject({
      ok: true,
      totalSinDescuento: 560_000,
      descuento: { codigo: "PROMO15", porcentaje: 15, monto: 84_000 },
      total: 476_000,
    });
  });

  it("incluye personas extra y adicionales en la base del descuento", () => {
    const r = cotizar(estadia("2026-11-10", "2026-11-11", 3), datos(), HOY); // 280 000 + 60 000
    if (!r.ok) throw new Error(r.error);
    expect(aplicarDescuento(r, codigo({ porcentaje: 10 }), HOY)).toMatchObject({
      descuento: { monto: 34_000 },
      total: 306_000,
    });
  });

  it("redondea el descuento al peso", () => {
    const cot: Cotizacion = { ...base(), totalSinDescuento: 99_999, total: 99_999 };
    expect(aplicarDescuento(cot, codigo(), HOY)).toMatchObject({
      descuento: { monto: 15_000 },
      total: 84_999,
    });
  });

  it("rechaza un código que no existe", () => {
    expect(aplicarDescuento(base(), null, HOY)).toEqual({
      ok: false,
      error: "codigo_invalido",
      motivo: "inexistente",
    });
  });

  it("rechaza un código inactivo, vencido o que aún no empieza", () => {
    const vencido = { ok: false, error: "codigo_invalido", motivo: "vencido" };
    expect(aplicarDescuento(base(), codigo({ activo: false }), HOY)).toEqual(vencido);
    expect(aplicarDescuento(base(), codigo({ validoHasta: "2026-10-20" }), HOY)).toEqual(vencido);
    expect(aplicarDescuento(base(), codigo({ validoDesde: "2026-10-22" }), HOY)).toEqual(vencido);
    // Los días límite cuentan.
    expect(
      aplicarDescuento(base(), codigo({ validoDesde: HOY, validoHasta: HOY }), HOY),
    ).toMatchObject({ ok: true });
  });

  it("rechaza un código sin usos disponibles", () => {
    expect(aplicarDescuento(base(), codigo({ usosMaximos: 3, usos: 3 }), HOY)).toMatchObject({
      error: "codigo_invalido",
      motivo: "agotado",
    });
    expect(aplicarDescuento(base(), codigo({ usosMaximos: 3, usos: 2 }), HOY)).toMatchObject({
      ok: true,
    });
  });

  it("exige que todas las noches caigan en el rango de estadía", () => {
    const fechas = { ok: false, error: "codigo_invalido", motivo: "fechas" };
    // Noches 10 y 11: basta con que una quede fuera.
    expect(aplicarDescuento(base(), codigo({ estadiaHasta: "2026-11-10" }), HOY)).toEqual(fechas);
    expect(aplicarDescuento(base(), codigo({ estadiaDesde: "2026-11-11" }), HOY)).toEqual(fechas);
    // La salida (12) no es noche: un rango hasta el 11 sirve.
    expect(
      aplicarDescuento(
        base(),
        codigo({ estadiaDesde: "2026-11-10", estadiaHasta: "2026-11-11" }),
        HOY,
      ),
    ).toMatchObject({ ok: true });
  });
});

describe("cabalgata", () => {
  // Estadía del martes 10 al jueves 12 de noviembre (2 noches, 280 000 c/u).
  const datosCab = (libres: Record<string, number> = {}): DatosCabalgata => ({
    servicioId: 1,
    nombre: "Cabalgata de prueba",
    precioPersona: 85_000,
    turnos: ["09:00", "15:00"],
    horaCheckin: "15:00:00",
    horaCheckout: "12:00:00",
    libres: new Map(
      Object.entries({
        "2026-11-10|15:00": 6,
        "2026-11-11|09:00": 6,
        "2026-11-11|15:00": 6,
        "2026-11-12|09:00": 6,
        ...libres,
      }),
    ),
  });
  const base = (huespedes = 2, adicionales = { adultos: 0, ninos: 0, menores: 0 }) => {
    const r = cotizar(
      { llegada: "2026-11-10", salida: "2026-11-12", huespedes, adicionales },
      datos(),
      HOY,
    );
    if (!r.ok) throw new Error(r.error);
    return r;
  };

  it("el día de llegada solo desde el check-in y el de salida solo antes del check-out", () => {
    const horas = { horaCheckin: "15:00:00", horaCheckout: "12:00:00" };
    const ok = (fecha: string, turno: string) =>
      turnoEnEstadia(fecha, turno, "2026-11-10", "2026-11-12", horas);
    expect(ok("2026-11-10", "09:00")).toBe(false);
    expect(ok("2026-11-10", "15:00")).toBe(true);
    expect(ok("2026-11-11", "09:00")).toBe(true);
    expect(ok("2026-11-12", "09:00")).toBe(true);
    expect(ok("2026-11-12", "15:00")).toBe(false);
    expect(ok("2026-11-09", "15:00")).toBe(false);
    expect(ok("2026-11-13", "09:00")).toBe(false);
    // Sin turno: cualquier día de la estadía.
    expect(ok("2026-11-10", "")).toBe(true);
  });

  it("ofrece los turnos de la estadía e indica si alcanzan para el grupo", () => {
    const opciones = opcionesCabalgata(
      "2026-11-10",
      "2026-11-12",
      4,
      datosCab({ "2026-11-11|09:00": 3 }),
    );
    expect(opciones).toEqual([
      { fecha: "2026-11-10", turnos: [{ turno: "15:00", libres: 6, alcanza: true }] },
      {
        fecha: "2026-11-11",
        turnos: [
          { turno: "09:00", libres: 3, alcanza: false },
          { turno: "15:00", libres: 6, alcanza: true },
        ],
      },
      { fecha: "2026-11-12", turnos: [{ turno: "09:00", libres: 6, alcanza: true }] },
    ]);
  });

  it("cobra a todo el grupo, sin los menores de 4 años", () => {
    expect(personasCabalgata(6, { adultos: 2, ninos: 1, menores: 1 })).toBe(9);
    const r = agregarCabalgata(
      base(6, { adultos: 1, ninos: 0, menores: 1 }),
      { servicio: "cabalgata-prueba", fecha: "2026-11-11", turno: "09:00" },
      datosCab({ "2026-11-11|09:00": 7 }),
    );
    expect(r).toMatchObject({
      ok: true,
      cabalgata: { fecha: "2026-11-11", turno: "09:00", personas: 7, subtotal: 595_000 },
    });
    if (r.ok) expect(r.total).toBe(r.totalSinDescuento + 595_000);
  });

  it("rechaza un turno fuera de la estadía o que no existe", () => {
    const invalida = { ok: false, error: "cabalgata_invalida" };
    expect(
      agregarCabalgata(
        base(),
        { servicio: "cabalgata-prueba", fecha: "2026-11-10", turno: "09:00" },
        datosCab(),
      ),
    ).toEqual(invalida);
    expect(
      agregarCabalgata(
        base(),
        { servicio: "cabalgata-prueba", fecha: "2026-11-13", turno: "09:00" },
        datosCab(),
      ),
    ).toEqual(invalida);
    expect(
      agregarCabalgata(
        base(),
        { servicio: "cabalgata-prueba", fecha: "2026-11-11", turno: "11:00" },
        datosCab(),
      ),
    ).toEqual(invalida);
  });

  it("rechaza si el grupo no cabe en el turno", () => {
    expect(
      agregarCabalgata(
        base(3),
        { servicio: "cabalgata-prueba", fecha: "2026-11-11", turno: "09:00" },
        datosCab({ "2026-11-11|09:00": 2 }),
      ),
    ).toEqual({ ok: false, error: "cabalgata_sin_cupo" });
  });

  it("el descuento solo rebaja el alojamiento, en cualquier orden", () => {
    const codigo: CodigoDescuento = {
      codigo: "PROMO15",
      porcentaje: 15,
      activo: true,
      validoDesde: null,
      validoHasta: null,
      estadiaDesde: null,
      estadiaHasta: null,
      usosMaximos: null,
      usos: 0,
    };
    const eleccion = { servicio: "cabalgata-prueba", fecha: "2026-11-11", turno: "15:00" };
    const primero = aplicarDescuento(base(), codigo, HOY);
    if (!primero.ok) throw new Error(primero.error);
    const a = agregarCabalgata(primero, eleccion, datosCab());
    const segundo = agregarCabalgata(base(), eleccion, datosCab());
    if (!segundo.ok) throw new Error(segundo.error);
    const b = aplicarDescuento(segundo, codigo, HOY);
    // 560 000 − 84 000 + 2 × 85 000
    expect(a).toMatchObject({ descuento: { monto: 84_000 }, total: 646_000 });
    expect(b).toMatchObject({ descuento: { monto: 84_000 }, total: 646_000 });
  });
});

describe("calcularTemporadasAltas", () => {
  it("2027: Semana Santa según Pascua (28 mar), mitad de año y fin de año hasta enero", () => {
    expect(calcularTemporadasAltas(2027).map((t) => [t.fechaInicio, t.fechaFin])).toEqual([
      ["2027-03-19", "2027-03-27"],
      ["2027-06-15", "2027-07-15"],
      ["2027-12-15", "2028-01-15"],
    ]);
  });

  it("sin precio propio: cobra precioTemporada", () => {
    const d = datos({ temporadas: calcularTemporadasAltas(2026) });
    expect(clasificarNoche("2026-04-01", d)).toMatchObject({ tipo: "temporada", precio: 560_000 });
    expect(clasificarNoche("2026-07-15", d)).toMatchObject({ tipo: "temporada", precio: 560_000 });
    expect(clasificarNoche("2026-07-16", d).tipo).not.toBe("temporada");
  });
});

describe("calcularFechasEspeciales", () => {
  // Fuente Amor y Amistad 2026: calendariodecolombia.com (tercer sábado de septiembre).
  it("2026", () => {
    expect(calcularFechasEspeciales(2026).map((f) => f.fecha)).toEqual([
      "2026-02-14",
      "2026-05-10",
      "2026-06-21",
      "2026-09-19",
      "2026-12-07",
      "2026-12-24",
      "2026-12-31",
    ]);
  });

  it("2027: Día de la Madre 9 may, Día del Padre 20 jun, Amor y Amistad 18 sep", () => {
    const fechas = calcularFechasEspeciales(2027).map((f) => f.fecha);
    expect(fechas).toContain("2027-05-09");
    expect(fechas).toContain("2027-06-20");
    expect(fechas).toContain("2027-09-18");
  });

  it("dentro de la temporada alta gana la fecha especial", () => {
    const ajustes = new Map(
      calcularFechasEspeciales(2026).map((e): [string, AjusteFecha] => [
        e.fecha,
        { fecha: e.fecha, precio: null, especial: true, bloqueada: false },
      ]),
    );
    const d = datos({ temporadas: calcularTemporadasAltas(2026), ajustes });
    expect(clasificarNoche("2026-12-24", d)).toMatchObject({ tipo: "ajuste", precio: 650_000 });
    expect(clasificarNoche("2026-06-21", d)).toMatchObject({ tipo: "ajuste", precio: 650_000 });
    expect(clasificarNoche("2026-12-23", d)).toMatchObject({ tipo: "temporada", precio: 560_000 });
  });
});

describe("mascotas", () => {
  // 10 y 11 nov 2026: martes y miércoles, tarifa base.
  it("se cobran por mascota y por noche, sin contar como huéspedes", () => {
    const r = cotizar({ ...estadia("2026-11-10", "2026-11-12", 1), mascotas: 2 }, datos(), HOY);
    expect(r).toMatchObject({ ok: true, mascotas: 2, extraMascotas: 200_000, personasExtra: 0 });
    if (r.ok) expect(r.total).toBe(r.subtotal + 200_000);
  });

  it("sin mascotas no suma nada", () => {
    const r = cotizar(estadia("2026-11-10", "2026-11-12"), datos(), HOY);
    expect(r).toMatchObject({ ok: true, mascotas: 0, extraMascotas: 0 });
  });

  it("rechaza cantidades negativas o decimales", () => {
    for (const mascotas of [-1, 1.5]) {
      expect(cotizar({ ...estadia("2026-11-10", "2026-11-12"), mascotas }, datos(), HOY)).toEqual({
        ok: false,
        error: "mascotas_invalidas",
      });
    }
  });
});
