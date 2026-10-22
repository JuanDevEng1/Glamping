// Prueba de concurrencia contra una BD real. Solo corre con DATABASE_URL_PRUEBAS
// (una BD de pruebas con las migraciones aplicadas; nunca la de producción).
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.DATABASE_URL_PRUEBAS;

describe.skipIf(!url)("reservas en BD de pruebas", () => {
  const codigos: string[] = [];

  beforeAll(() => {
    process.env.DATABASE_URL = url;
  });

  afterAll(async () => {
    const { getDb, reservas } = await import("../src/db");
    if (codigos.length) await getDb().delete(reservas).where(inArray(reservas.codigo, codigos));
    await getDb().$client.end();
  });

  it("dos reservas simultáneas para las mismas fechas: solo una gana", async () => {
    const { configuracion, getDb } = await import("../src/db");
    const { crearReservaPendiente } = await import("../src/reservas");
    const { hoyEnBogota } = await import("../src/moneda");
    const { sumarDias } = await import("../src/precios");

    await getDb()
      .insert(configuracion)
      .values({ precioBase: 280_000, precioAlto: 350_000, precioPersonaExtra: 60_000 })
      .onConflictDoNothing();

    // Fechas lejanas para no chocar con datos de desarrollo.
    const llegada = sumarDias(hoyEnBogota(), 500);
    const entrada = {
      estadia: { llegada, salida: sumarDias(llegada, 3), huespedes: 2 },
      huesped: {
        nombre: "Prueba Concurrencia",
        tipoDocumento: "CC",
        documento: "123456",
        correo: "prueba@example.com",
        telefono: "3000000000",
        pais: "Colombia",
        aceptaTerminos: true,
      },
    };

    const resultados = await Promise.all([
      crearReservaPendiente(entrada),
      crearReservaPendiente(entrada),
    ]);
    for (const r of resultados) if (r.ok) codigos.push(r.codigo);

    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    expect(resultados.find((r) => !r.ok)).toMatchObject({ ok: false, error: "no_disponible" });
  });
});
