import { describe, expect, it } from "vitest";
import {
  calcularFestivos,
  calendarioMes,
  clasificarNoche,
  cotizar,
  type AjusteFecha,
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
  precioPersonaExtra: 60_000,
  maxHuespedes: 6,
  huespedesIncluidos: 2,
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
        ["2026-12-24", { fecha: "2026-12-24", precio: 600_000, bloqueada: false }],
      ]),
    });
    expect(clasificarNoche("2026-12-24", d)).toMatchObject({ tipo: "ajuste", precio: 600_000 });
  });

  it("una fecha bloqueada queda marcada como bloqueada", () => {
    const d = datos({
      ajustes: new Map([["2026-11-20", { fecha: "2026-11-20", precio: null, bloqueada: true }]]),
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
        ["2026-12-24", { fecha: "2026-12-24", precio: 600_000, bloqueada: false }],
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
      ajustes: new Map([["2026-11-20", { fecha: "2026-11-20", precio: null, bloqueada: true }]]),
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
      ajustes: new Map([["2026-11-20", { fecha: "2026-11-20", precio: null, bloqueada: true }]]),
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
