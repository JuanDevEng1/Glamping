// Reservas del admin y códigos de descuento contra una BD real (días 700+: no chocan con
// las fechas de reservas.test.ts ni pagos.test.ts, que corren en paralelo). Solo corre con
// DATABASE_URL_PRUEBAS (una BD de pruebas con las migraciones aplicadas; nunca la de producción).
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.DATABASE_URL_PRUEBAS;

describe.skipIf(!url)("admin en BD de pruebas", () => {
  const codigos: string[] = [];
  const codigosDescuento: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    const { configuracion, getDb } = await import("../src/db");
    await getDb()
      .insert(configuracion)
      .values({ precioBase: 280_000, precioAlto: 350_000, precioPersonaExtra: 60_000 })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    const { codigosDescuento: tabla, getDb, reservas } = await import("../src/db");
    if (codigos.length) await getDb().delete(reservas).where(inArray(reservas.codigo, codigos));
    if (codigosDescuento.length)
      await getDb().delete(tabla).where(inArray(tabla.codigo, codigosDescuento));
    await getDb().$client.end();
  });

  async function fechas(dias: number, noches = 2) {
    const { hoyEnBogota } = await import("../src/moneda");
    const { sumarDias } = await import("../src/precios");
    const llegada = sumarDias(hoyEnBogota(), dias);
    return { llegada, salida: sumarDias(llegada, noches) };
  }

  const ganadora = {
    nombre: "Ganadora Prueba",
    correo: "rifa@example.com",
    telefono: "3000000000",
  };

  it("una rifa ocupa las noches: la web no puede reservarlas hasta liberarla", async () => {
    const { cancelarReservaAdmin, crearReservaAdmin } = await import("../src/admin");
    const { cotizarEstadia, crearReservaPendiente, obtenerReservaPublica } =
      await import("../src/reservas");

    const { llegada, salida } = await fechas(700);
    const r = await crearReservaAdmin({
      origen: "rifa",
      llegada,
      salida,
      motivo: "Rifa de prueba",
      ...ganadora,
    });
    if (!r.ok) throw new Error(`No se creó la rifa: ${r.error}`);
    codigos.push(r.codigo);
    expect(r.noches).toBe(2);

    expect(await obtenerReservaPublica(r.codigo)).toMatchObject({
      estado: "confirmada",
      origen: "rifa",
      totalCop: 0,
    });
    expect(await cotizarEstadia({ llegada, salida, huespedes: 2 })).toMatchObject({
      ok: false,
      error: "no_disponible",
    });
    const web = await crearReservaPendiente({
      estadia: { llegada, salida, huespedes: 2 },
      huesped: {
        ...ganadora,
        tipoDocumento: "CC",
        documento: "123456",
        pais: "Colombia",
        aceptaTerminos: true,
      },
    });
    if (web.ok) codigos.push(web.codigo);
    expect(web).toMatchObject({ ok: false, error: "no_disponible" });

    expect(await cancelarReservaAdmin(r.codigo)).toEqual({ ok: true });
    expect(await cancelarReservaAdmin(r.codigo)).toEqual({ ok: false, error: "no_confirmada" });
    expect(await cotizarEstadia({ llegada, salida, huespedes: 2 })).not.toMatchObject({
      error: "no_disponible",
    });
  });

  it("no se cruza con una reserva web y no cancela reservas web", async () => {
    const { cancelarReservaAdmin, crearReservaAdmin } = await import("../src/admin");
    const { crearReservaPendiente } = await import("../src/reservas");

    const { llegada, salida } = await fechas(710, 3);
    const web = await crearReservaPendiente({
      estadia: { llegada, salida, huespedes: 2 },
      huesped: {
        ...ganadora,
        tipoDocumento: "CC",
        documento: "123456",
        pais: "Colombia",
        aceptaTerminos: true,
      },
    });
    if (!web.ok) throw new Error(`No se creó la reserva web: ${web.error}`);
    codigos.push(web.codigo);

    const { llegada: dentro } = await fechas(711, 1);
    const bloqueo = await crearReservaAdmin({
      origen: "mantenimiento",
      llegada: dentro,
      salida,
      motivo: "Reparación de prueba",
    });
    if (bloqueo.ok) codigos.push(bloqueo.codigo);
    expect(bloqueo).toMatchObject({
      ok: false,
      error: "no_disponible",
      choques: [{ codigo: web.codigo, origen: "web" }],
    });

    expect(await cancelarReservaAdmin(web.codigo)).toEqual({ ok: false, error: "es_web" });
  });

  it("valida fechas y datos del beneficiario", async () => {
    const { crearReservaAdmin } = await import("../src/admin");
    const pasado = await fechas(-3);
    expect(
      await crearReservaAdmin({ origen: "mantenimiento", ...pasado, motivo: "Reparación" }),
    ).toEqual({ ok: false, error: "fechas_invalidas" });

    const futuro = await fechas(720);
    expect(
      await crearReservaAdmin({ origen: "cortesia", ...futuro, motivo: "Regalo" }),
    ).toMatchObject({
      ok: false,
      error: "datos_invalidos",
      errores: { nombre: expect.any(Array) },
    });
  });

  it("crea, lista y desactiva códigos de descuento", async () => {
    const { crearCodigoDescuento, desactivarCodigoDescuento, listarCodigos } =
      await import("../src/admin");
    const codigo = `PRUEBA-ADM${Date.now().toString(36).toUpperCase()}`;

    expect(
      await crearCodigoDescuento({
        codigo: codigo.toLowerCase(),
        porcentaje: "15",
        usosMaximos: "10",
      }),
    ).toEqual({
      ok: true,
      codigo,
    });
    codigosDescuento.push(codigo);
    expect(await crearCodigoDescuento({ codigo, porcentaje: 20 })).toEqual({
      ok: false,
      error: "ya_existe",
    });
    expect(await crearCodigoDescuento({ codigo: `${codigo}X`, porcentaje: 95 })).toMatchObject({
      ok: false,
      error: "datos_invalidos",
      errores: { porcentaje: expect.any(Array) },
    });
    expect(
      await crearCodigoDescuento({
        codigo: `${codigo}Y`,
        porcentaje: 10,
        validoDesde: "2027-02-01",
        validoHasta: "2027-01-01",
      }),
    ).toMatchObject({ ok: false, error: "datos_invalidos" });

    expect(await desactivarCodigoDescuento(codigo)).toBe(true);
    const lista = await listarCodigos();
    expect(lista.find((c) => c.codigo === codigo)).toMatchObject({
      porcentaje: 15,
      usosMaximos: 10,
      activo: false,
      usos: 0,
    });
  });
});
