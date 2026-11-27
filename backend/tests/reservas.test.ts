// Prueba de concurrencia contra una BD real. Solo corre con DATABASE_URL_PRUEBAS
// (una BD de pruebas con las migraciones aplicadas; nunca la de producción).
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { extensionDocumento } from "../src/reservas";

const url = process.env.DATABASE_URL_PRUEBAS;

const PDF = new TextEncoder().encode("%PDF-1.7\n...");

describe("tipo de archivo del documento", () => {
  it("reconoce JPG, PNG y PDF por sus primeros bytes", () => {
    expect(extensionDocumento(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpg");
    expect(
      extensionDocumento(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])),
    ).toBe("png");
    expect(extensionDocumento(PDF)).toBe("pdf");
  });

  it("rechaza otros formatos aunque el nombre diga .pdf", () => {
    expect(extensionDocumento(new TextEncoder().encode("<html>"))).toBeNull();
    expect(extensionDocumento(new Uint8Array([0x25, 0x50]))).toBeNull();
    expect(extensionDocumento(new Uint8Array())).toBeNull();
  });
});

describe.skipIf(!url)("reservas en BD de pruebas", () => {
  const codigos: string[] = [];

  beforeAll(() => {
    process.env.DATABASE_URL = url;
  });

  const codigosDescuento: string[] = [];
  const fechasCupos: string[] = [];
  let cabalgataId = 0;

  /** Deja la cabalgata activa con turnos 9:00 y 15:00, 6 por turno y 85 000 por persona. */
  async function asegurarCabalgata() {
    const { aliados, getDb, servicios } = await import("../src/db");
    const { SLUG_CABALGATA } = await import("../src/reservas");
    const valores = {
      activo: true,
      turnos: ["09:00", "15:00"],
      precio: 85_000,
      capacidadTurno: 6,
    };
    const [existente] = await getDb()
      .select({ id: servicios.id })
      .from(servicios)
      .where(eq(servicios.slug, SLUG_CABALGATA));
    if (existente) {
      await getDb().update(servicios).set(valores).where(eq(servicios.id, existente.id));
      cabalgataId = existente.id;
      return;
    }
    const [aliado] = await getDb()
      .insert(aliados)
      .values({ nombre: "Aliado de prueba", correo: "aliado@example.com" })
      .returning({ id: aliados.id });
    const [s] = await getDb()
      .insert(servicios)
      .values({
        slug: SLUG_CABALGATA,
        aliadoId: aliado!.id,
        nombre: "Cabalgata al mirador",
        categoria: "tours",
        resumen: "Cabalgata de prueba",
        descripcion: "Cabalgata de prueba",
        unidadPrecio: "persona",
        tipoStock: "cupos",
        ...valores,
      })
      .returning({ id: servicios.id });
    cabalgataId = s!.id;
  }

  async function fijarCupo(fecha: string, turno: string, capacidad: number) {
    const { cuposServicio, getDb } = await import("../src/db");
    fechasCupos.push(fecha);
    await getDb()
      .insert(cuposServicio)
      .values({ servicioId: cabalgataId, fecha, turno, capacidad })
      .onConflictDoUpdate({
        target: [cuposServicio.servicioId, cuposServicio.fecha, cuposServicio.turno],
        set: { capacidad },
      });
  }

  afterAll(async () => {
    const { codigosDescuento: tabla, getDb, reservas } = await import("../src/db");
    if (codigos.length) await getDb().delete(reservas).where(inArray(reservas.codigo, codigos));
    if (codigosDescuento.length)
      await getDb().delete(tabla).where(inArray(tabla.codigo, codigosDescuento));
    if (fechasCupos.length) {
      const { cuposServicio } = await import("../src/db");
      await getDb()
        .delete(cuposServicio)
        .where(
          and(eq(cuposServicio.servicioId, cabalgataId), inArray(cuposServicio.fecha, fechasCupos)),
        );
    }
    await getDb().$client.end();
  });

  async function nuevoCodigoDescuento(cambios: { usosMaximos?: number } = {}) {
    const { codigosDescuento: tabla, getDb } = await import("../src/db");
    const codigo = `PRUEBA-${Date.now().toString(36).toUpperCase()}${codigosDescuento.length}`;
    const [fila] = await getDb()
      .insert(tabla)
      .values({ codigo, porcentaje: 15, ...cambios })
      .returning();
    codigosDescuento.push(codigo);
    return fila!;
  }

  const huespedPrueba = {
    nombre: "Prueba Descuento",
    tipoDocumento: "CC",
    documento: "123456",
    correo: "prueba@example.com",
    telefono: "3000000000",
    pais: "Colombia",
    aceptaTerminos: true,
  };

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

  it("el documento se envía al admin una sola vez y solo con la reserva confirmada", async () => {
    const { getDb, reservas } = await import("../src/db");
    const { crearReservaPendiente, MAX_BYTES_DOCUMENTO, recibirDocumentoReserva } =
      await import("../src/reservas");
    const { hoyEnBogota } = await import("../src/moneda");
    const { sumarDias } = await import("../src/precios");

    vi.stubEnv("RESEND_API_KEY", "re_prueba");
    vi.stubEnv("CORREO_REMITENTE", "Lauburu <onboarding@resend.dev>");
    vi.stubEnv("CORREO_ADMIN", "admin@example.com");
    const resend = vi.fn(async () => Response.json({ id: "correo-prueba" }));
    vi.stubGlobal("fetch", resend);

    const llegada = sumarDias(hoyEnBogota(), 520);
    const creada = await crearReservaPendiente({
      estadia: { llegada, salida: sumarDias(llegada, 2), huespedes: 2 },
      huesped: {
        nombre: "Prueba Documento",
        tipoDocumento: "PA",
        documento: "AB123456",
        correo: "prueba@example.com",
        telefono: "3000000000",
        pais: "Colombia",
        aceptaTerminos: true,
      },
    });
    if (!creada.ok) throw new Error(`No se creó la reserva: ${creada.error}`);
    codigos.push(creada.codigo);
    const archivo = new Blob([PDF], { type: "application/pdf" });

    try {
      // Pendiente de pago: no se acepta.
      expect(await recibirDocumentoReserva(creada.codigo, archivo)).toEqual({
        ok: false,
        error: "no_disponible",
      });

      await getDb()
        .update(reservas)
        .set({ estado: "confirmada" })
        .where(eq(reservas.codigo, creada.codigo));

      expect(
        await recibirDocumentoReserva(creada.codigo, new Blob([new TextEncoder().encode("hola")])),
      ).toEqual({ ok: false, error: "archivo_invalido" });
      expect(
        await recibirDocumentoReserva(
          creada.codigo,
          new Blob([new Uint8Array(MAX_BYTES_DOCUMENTO + 1)]),
        ),
      ).toEqual({ ok: false, error: "archivo_grande" });
      expect(resend).not.toHaveBeenCalled();

      expect(await recibirDocumentoReserva(creada.codigo, archivo)).toEqual({ ok: true });
      expect(resend).toHaveBeenCalledTimes(1);
      const [urlResend, opciones] = resend.mock.calls[0] as unknown as [string, RequestInit];
      expect(urlResend).toBe("https://api.resend.com/emails");
      const cuerpo = JSON.parse(String(opciones.body));
      expect(cuerpo.to).toEqual(["admin@example.com"]);
      expect(cuerpo.text).toContain("Pasaporte AB123456");
      expect(cuerpo.attachments).toEqual([
        {
          filename: `${creada.codigo}-documento.pdf`,
          content: Buffer.from(PDF).toString("base64"),
        },
      ]);

      expect(await recibirDocumentoReserva(creada.codigo, archivo)).toEqual({
        ok: false,
        error: "ya_recibido",
      });
      expect(resend).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
  });

  it("una reserva con código guarda el descuento y cobra el total con descuento", async () => {
    const { getDb, reservas } = await import("../src/db");
    const { crearReservaPendiente } = await import("../src/reservas");
    const { hoyEnBogota } = await import("../src/moneda");
    const { sumarDias } = await import("../src/precios");

    const codigo = await nuevoCodigoDescuento();
    const llegada = sumarDias(hoyEnBogota(), 540);
    const r = await crearReservaPendiente({
      estadia: { llegada, salida: sumarDias(llegada, 2), huespedes: 2, codigo: codigo.codigo },
      huesped: huespedPrueba,
    });
    if (!r.ok) throw new Error(`No se creó la reserva: ${r.error}`);
    codigos.push(r.codigo);

    const monto = Math.round((r.cotizacion.totalSinDescuento * 15) / 100);
    expect(r.cotizacion.descuento).toEqual({ codigo: codigo.codigo, porcentaje: 15, monto });
    expect(r.cotizacion.total).toBe(r.cotizacion.totalSinDescuento - monto);

    const [fila] = await getDb().select().from(reservas).where(eq(reservas.codigo, r.codigo));
    expect(fila).toMatchObject({
      totalCop: r.cotizacion.total,
      descuentoCop: monto,
      codigoDescuentoId: codigo.id,
    });
  });

  it("un código de un solo uso no se usa dos veces, y un hold vencido lo libera", async () => {
    const { getDb, reservas } = await import("../src/db");
    const { crearReservaPendiente } = await import("../src/reservas");
    const { hoyEnBogota } = await import("../src/moneda");
    const { sumarDias } = await import("../src/precios");

    const { codigo } = await nuevoCodigoDescuento({ usosMaximos: 1 });
    const reservar = (dias: number) => {
      const llegada = sumarDias(hoyEnBogota(), dias);
      return crearReservaPendiente({
        estadia: { llegada, salida: sumarDias(llegada, 2), huespedes: 2, codigo },
        huesped: huespedPrueba,
      });
    };

    // Fechas distintas: solo compiten por el código.
    const resultados = await Promise.all([reservar(560), reservar(570)]);
    for (const r of resultados) if (r.ok) codigos.push(r.codigo);
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    expect(resultados.find((r) => !r.ok)).toMatchObject({
      error: "codigo_invalido",
      motivo: "agotado",
    });

    const ganadora = resultados.find((r) => r.ok)!;
    if (!ganadora.ok) throw new Error("sin ganadora");
    await getDb()
      .update(reservas)
      .set({ expiraEn: sql`now() - interval '1 minute'` })
      .where(eq(reservas.codigo, ganadora.codigo));

    const otra = await reservar(580);
    if (otra.ok) codigos.push(otra.codigo);
    expect(otra).toMatchObject({ ok: true, cotizacion: { descuento: { codigo } } });
  });

  it("una reserva con cabalgata guarda el grupo y suma su precio al total", async () => {
    const { getDb, reservas } = await import("../src/db");
    const { crearReservaPendiente, obtenerCabalgata, obtenerReservaPublica } =
      await import("../src/reservas");
    const { hoyEnBogota } = await import("../src/moneda");
    const { sumarDias } = await import("../src/precios");
    await asegurarCabalgata();

    const llegada = sumarDias(hoyEnBogota(), 740);
    const salida = sumarDias(llegada, 2);
    const dia = sumarDias(llegada, 1);
    const r = await crearReservaPendiente({
      estadia: { llegada, salida, huespedes: 3, cabalgata: { fecha: dia, turno: "09:00" } },
      huesped: huespedPrueba,
    });
    if (!r.ok) throw new Error(`No se creó la reserva: ${r.error}`);
    codigos.push(r.codigo);

    expect(r.cotizacion.cabalgata).toEqual({
      fecha: dia,
      turno: "09:00",
      personas: 3,
      precioPersona: 85_000,
      subtotal: 255_000,
    });
    expect(r.cotizacion.total).toBe(r.cotizacion.totalSinDescuento + 255_000);
    const [fila] = await getDb().select().from(reservas).where(eq(reservas.codigo, r.codigo));
    expect(fila).toMatchObject({
      totalCop: r.cotizacion.total,
      cabalgataFecha: dia,
      cabalgataTurno: "09:00",
      cabalgataPersonas: 3,
      cabalgataCop: 255_000,
    });
    expect((await obtenerReservaPublica(r.codigo))?.cabalgata).toEqual({
      fecha: dia,
      turno: "09:00",
      personas: 3,
      totalCop: 255_000,
    });

    // El hold ocupa 3 de los 6 cupos de ese turno.
    const info = await obtenerCabalgata({ llegada, salida, huespedes: 4 });
    const turno = info?.opciones
      .find((o) => o.fecha === dia)
      ?.turnos.find((t) => t.turno === "09:00");
    expect(turno).toEqual({ turno: "09:00", libres: 3, alcanza: false });
  });

  it("un turno cerrado o pequeño para el grupo no se puede elegir", async () => {
    const { crearReservaPendiente, obtenerCabalgata } = await import("../src/reservas");
    const { hoyEnBogota } = await import("../src/moneda");
    const { sumarDias } = await import("../src/precios");
    await asegurarCabalgata();

    const llegada = sumarDias(hoyEnBogota(), 750);
    const salida = sumarDias(llegada, 2);
    const dia = sumarDias(llegada, 1);
    await fijarCupo(dia, "09:00", 0);
    await fijarCupo(dia, "15:00", 2);

    const info = await obtenerCabalgata({ llegada, salida, huespedes: 3 });
    expect(info?.opciones.find((o) => o.fecha === dia)?.turnos).toEqual([
      { turno: "09:00", libres: 0, alcanza: false },
      { turno: "15:00", libres: 2, alcanza: false },
    ]);
    for (const turno of ["09:00", "15:00"]) {
      const r = await crearReservaPendiente({
        estadia: { llegada, salida, huespedes: 3, cabalgata: { fecha: dia, turno } },
        huesped: huespedPrueba,
      });
      if (r.ok) codigos.push(r.codigo);
      expect(r).toEqual({ ok: false, error: "cabalgata_sin_cupo" });
    }
  });

  it("si cierran la cabalgata antes de confirmar el pago, no se confirma (sin_cupo)", async () => {
    const { getDb, reservas } = await import("../src/db");
    const { confirmarReserva, crearReservaPendiente } = await import("../src/reservas");
    const { hoyEnBogota } = await import("../src/moneda");
    const { sumarDias } = await import("../src/precios");
    await asegurarCabalgata();

    const llegada = sumarDias(hoyEnBogota(), 760);
    const dia = sumarDias(llegada, 1);
    const r = await crearReservaPendiente({
      estadia: {
        llegada,
        salida: sumarDias(llegada, 2),
        huespedes: 2,
        cabalgata: { fecha: dia, turno: "15:00" },
      },
      huesped: huespedPrueba,
    });
    if (!r.ok) throw new Error(`No se creó la reserva: ${r.error}`);
    codigos.push(r.codigo);
    const [fila] = await getDb().select().from(reservas).where(eq(reservas.codigo, r.codigo));

    await fijarCupo(dia, "15:00", 1);
    const resultado = await getDb().transaction((tx) => confirmarReserva(tx, fila!.id, "paypal"));
    expect(resultado).toBe("sin_cupo");
    const [despues] = await getDb().select().from(reservas).where(eq(reservas.id, fila!.id));
    expect(despues!.estado).toBe("pendiente");

    // Con cupo suficiente sí se confirma (su propio hold no cuenta en contra).
    await fijarCupo(dia, "15:00", 2);
    expect(await getDb().transaction((tx) => confirmarReserva(tx, fila!.id, "paypal"))).toBe(
      "confirmada",
    );
  });
});
