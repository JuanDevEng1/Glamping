import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { centavosAValor, copAUsdCentavos, valorACentavos } from "../src/moneda";

const url = process.env.DATABASE_URL_PRUEBAS;

// Contra la BD de pruebas (ver pagos.test.ts). Restaura la TRM guardada al terminar.
describe.skipIf(!url)("TRM guardada en BD de pruebas", () => {
  let original: { trmValor: string | null; trmFecha: string | null } | undefined;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    const { configuracion, getDb } = await import("../src/db");
    const db = getDb();
    await db
      .insert(configuracion)
      .values({ precioBase: 280_000, precioAlto: 350_000, precioPersonaExtra: 60_000 })
      .onConflictDoNothing();
    [original] = await db
      .select({ trmValor: configuracion.trmValor, trmFecha: configuracion.trmFecha })
      .from(configuracion)
      .limit(1);
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    const { configuracion, getDb } = await import("../src/db");
    if (original) await getDb().update(configuracion).set(original);
  });

  it("no consulta datos.gov.co si ya hay TRM de hoy", async () => {
    const { configuracion, getDb } = await import("../src/db");
    const { hoyEnBogota, trmParaCobro } = await import("../src/moneda");
    // Mismo valor que pagos.test.ts, que puede correr en paralelo.
    await getDb().update(configuracion).set({ trmValor: "4000.00", trmFecha: hoyEnBogota() });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    expect(await trmParaCobro()).toEqual({ valor: 4000, fecha: hoyEnBogota() });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("conversión COP → USD para PayPal", () => {
  it("convierte exacto cuando la división es entera", () => {
    expect(copAUsdCentavos(390_000, 3900)).toBe(10_000);
  });

  it("redondea hacia arriba al centavo", () => {
    // 100 000 / 3912,45 = 25,5597… USD
    expect(copAUsdCentavos(100_000, 3912.45)).toBe(2556);
    expect(copAUsdCentavos(1, 4000)).toBe(1);
  });

  it("usa la TRM con dos decimales", () => {
    expect(copAUsdCentavos(391_245, 3912.449)).toBe(10_000);
  });
});

describe("formato de montos de PayPal", () => {
  it("centavos → valor", () => {
    expect(centavosAValor(12_345)).toBe("123.45");
    expect(centavosAValor(100)).toBe("1.00");
    expect(centavosAValor(5)).toBe("0.05");
  });

  it("valor → centavos", () => {
    expect(valorACentavos("123.45")).toBe(12_345);
    expect(valorACentavos("10")).toBe(1000);
    expect(valorACentavos("10.5")).toBe(1050);
    expect(valorACentavos("1.234")).toBeNull();
    expect(valorACentavos("-1.00")).toBeNull();
    expect(valorACentavos("abc")).toBeNull();
  });
});
