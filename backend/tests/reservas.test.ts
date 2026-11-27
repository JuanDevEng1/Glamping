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
  /** Cabalgata propia de las pruebas (con turnos), para no tocar las reales. */
  const SLUG_PRUEBA = "cabalgata-prueba-turnos";
  let cabalgataId = 0;
  let aliadoPruebaId = 0;

  /** Crea (una vez) la cabalgata de prueba: turnos 9:00 y 15:00, 6 caballos, 85 000 c/u. */
  async function asegurarCabalgata() {
    if (cabalgataId) return;
    const { aliados, getDb, servicios } = await import("../src/db");
    const [aliado] = await getDb()
      .insert(aliados)
      .values({ nombre: "Aliado de prueba", correo: "aliado@example.com" })
      .returning({ id: aliados.id });
    aliadoPruebaId = aliado!.id;
    const valores = {
      aliadoId: aliadoPruebaId,
      nombre: "Cabalgata de prueba",
      categoria: "tours" as const,
      resumen: "Cabalgata de prueba",
      descripcion: "Cabalgata de prueba",
      unidadPrecio: "caballo" as const,
      tipoStock: "cupos" as const,
      activo: true,
      turnos: ["09:00", "15:00"],
      precio: 85_000,
      capacidadTurno: 6,
    };
    const [s] = await getDb()
      .insert(servicios)
      .values({ slug: SLUG_PRUEBA, ...valores })
      .onConflictDoUpdate({ target: servicios.slug, set: valores })
      .returning({ id: servicios.id });
    cabalgataId = s!.id;
  }

  async function fijarCupo(fecha: string, turno: string, capacidad: number) {
    const { cuposServicio, getDb } = await import("../src/db");
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
    if (cabalgataId) {
      const { aliados, cuposServicio, servicios } = await import("../src/db");
      // Por si alguna reserva de la cabalgata de prueba no quedó en `codigos`.
      await getDb().delete(reservas).where(eq(reservas.cabalgataServicioId, cabalgataId));
      await getDb().delete(cuposServicio).where(eq(cuposServicio.servicioId, cabalgataId));
      await getDb().delete(servicios).where(eq(servicios.id, cabalgataId));
      await getDb().delete(aliados).where(eq(aliados.id, aliadoPruebaId));
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
    contactoEmergencia: "Contacto Prueba",
    telefonoEmergencia: "3110000000",
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
        contactoEmergencia: "Contacto Prueba",
        telefonoEmergencia: "3110000000",
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
        contactoEmergencia: "Contacto Prueba",
        telefonoEmergencia: "3110000000",
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
    const llegada = sumarDias(hoyEnBogota(), 800);
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
    const resultados = await Promise.all([reservar(820), reservar(830)]);
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

    const otra = await reservar(840);
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
      estadia: {
        llegada,
        salida,
        huespedes: 3,
        cabalgata: { servicio: SLUG_PRUEBA, fecha: dia, turno: "09:00" },
      },
      huesped: huespedPrueba,
    });
    if (!r.ok) throw new Error(`No se creó la reserva: ${r.error}`);
    codigos.push(r.codigo);

    expect(r.cotizacion.cabalgata).toEqual({
      servicioId: cabalgataId,
      nombre: "Cabalgata de prueba",
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
      cabalgataServicioId: cabalgataId,
      cabalgataFecha: dia,
      cabalgataTurno: "09:00",
      cabalgataPersonas: 3,
      cabalgataCop: 255_000,
    });
    expect((await obtenerReservaPublica(r.codigo))?.cabalgata).toEqual({
      nombre: "Cabalgata de prueba",
      fecha: dia,
      turno: "09:00",
      personas: 3,
      totalCop: 255_000,
    });

    // El hold ocupa 3 de los 6 cupos de ese turno.
    const info = await obtenerCabalgata({ llegada, salida, huespedes: 4 });
    const turno = info?.cabalgatas
      .find((c) => c.slug === SLUG_PRUEBA)
      ?.dias.find((o) => o.fecha === dia)
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
    const prueba = info?.cabalgatas.find((c) => c.slug === SLUG_PRUEBA);
    expect(prueba?.dias.find((o) => o.fecha === dia)?.turnos).toEqual([
      { turno: "09:00", libres: 0, alcanza: false },
      { turno: "15:00", libres: 2, alcanza: false },
    ]);
    for (const turno of ["09:00", "15:00"]) {
      const r = await crearReservaPendiente({
        estadia: {
          llegada,
          salida,
          huespedes: 3,
          cabalgata: { servicio: SLUG_PRUEBA, fecha: dia, turno },
        },
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
        cabalgata: { servicio: SLUG_PRUEBA, fecha: dia, turno: "15:00" },
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

  async function crear(diasDesdeHoy: number, cambios: Record<string, unknown> = {}) {
    const { crearReservaPendiente } = await import("../src/reservas");
    const { hoyEnBogota } = await import("../src/moneda");
    const { sumarDias } = await import("../src/precios");
    const llegada = sumarDias(hoyEnBogota(), diasDesdeHoy);
    const r = await crearReservaPendiente({
      estadia: { llegada, salida: sumarDias(llegada, 2), huespedes: 2, ...cambios },
      huesped: {
        nombre: "Prueba Reservas",
        tipoDocumento: "CC",
        documento: "123456",
        correo: "reservas@example.com",
        telefono: "3000000000",
        pais: "Colombia",
        contactoEmergencia: "Contacto Prueba",
        telefonoEmergencia: "3110000000",
        alergias: "Maní",
        aceptaTerminos: true,
      },
    });
    if (r.ok) codigos.push(r.codigo);
    return r;
  }

  it("guarda mascotas, alergias y contacto de emergencia; sin contacto no crea la reserva", async () => {
    const { crearReservaPendiente } = await import("../src/reservas");
    const { getDb, reservas } = await import("../src/db");

    const r = await crear(540, { mascotas: 2 });
    if (!r.ok) throw new Error(`No se creó la reserva: ${r.error}`);
    expect(r.cotizacion.extraMascotas).toBe(2 * 2 * r.cotizacion.precioMascota);
    const [fila] = await getDb().select().from(reservas).where(eq(reservas.codigo, r.codigo));
    expect(fila).toMatchObject({
      mascotas: 2,
      alergias: "Maní",
      contactoEmergencia: "Contacto Prueba",
      telefonoEmergencia: "3110000000",
      totalCop: r.cotizacion.total,
    });

    const sinContacto = await crearReservaPendiente({
      estadia: { llegada: "2030-01-10", salida: "2030-01-12", huespedes: 2 },
      huesped: {
        nombre: "Prueba Reservas",
        tipoDocumento: "CC",
        documento: "123456",
        correo: "reservas@example.com",
        telefono: "3000000000",
        pais: "Colombia",
        aceptaTerminos: true,
      },
    });
    expect(sinContacto).toMatchObject({ ok: false, error: "datos_invalidos" });
    if (!sinContacto.ok && sinContacto.error === "datos_invalidos") {
      expect(Object.keys(sinContacto.errores)).toEqual(
        expect.arrayContaining(["contactoEmergencia", "telefonoEmergencia"]),
      );
    }
  });

  it("liberar cancela la reserva pendiente y no toca una confirmada", async () => {
    const { getDb, reservas } = await import("../src/db");
    const { liberarReservaPendiente } = await import("../src/reservas");
    const estado = async (codigo: string) =>
      (await getDb().select().from(reservas).where(eq(reservas.codigo, codigo)))[0]?.estado;

    const pendiente = await crear(560);
    const confirmada = await crear(570);
    if (!pendiente.ok || !confirmada.ok) throw new Error("No se crearon las reservas");
    await getDb()
      .update(reservas)
      .set({ estado: "confirmada" })
      .where(eq(reservas.codigo, confirmada.codigo));

    await liberarReservaPendiente(pendiente.codigo);
    await liberarReservaPendiente(confirmada.codigo);
    expect(await estado(pendiente.codigo)).toBe("cancelada");
    expect(await estado(confirmada.codigo)).toBe("confirmada");

    // Las fechas liberadas se pueden volver a reservar.
    expect(await crear(560)).toMatchObject({ ok: true });
  });

  it("un apartado vencido libera las fechas y queda expirado", async () => {
    const { getDb, reservas } = await import("../src/db");
    const { sql } = await import("drizzle-orm");

    const primera = await crear(580);
    if (!primera.ok) throw new Error("No se creó la reserva");
    expect(await crear(580)).toMatchObject({ ok: false, error: "no_disponible" });

    await getDb()
      .update(reservas)
      .set({ expiraEn: sql`now() - interval '1 minute'` })
      .where(eq(reservas.codigo, primera.codigo));

    expect(await crear(580)).toMatchObject({ ok: true });
    const [fila] = await getDb().select().from(reservas).where(eq(reservas.codigo, primera.codigo));
    expect(fila?.estado).toBe("expirada");
  });

  it("un error de BD llega al log sin datos personales", async () => {
    const { errorSinDatos, getDb, reservas } = await import("../src/db");
    let original: unknown;
    try {
      // huespedes = 99 viola reservas_huespedes.
      await getDb().insert(reservas).values({
        codigo: "LAU-ERRORPRB",
        fechaLlegada: "2030-02-01",
        fechaSalida: "2030-02-02",
        huespedes: 99,
        totalCop: 1,
        desglose: [],
        nombre: "Dato Secreto",
        correo: "secreto@example.com",
        telefono: "3000000000",
        tipoDocumento: "CC",
        documento: "999999",
        pais: "Colombia",
        expiraEn: new Date(),
        terminosVersion: "1",
      });
    } catch (error) {
      original = error;
    }
    // El error de Drizzle sí trae los parámetros: por eso no se registra tal cual.
    expect(String((original as Error).message)).toContain("secreto@example.com");
    const limpio = errorSinDatos("No se pudo crear la reserva", original).message;
    expect(limpio).toContain("23514");
    expect(limpio).not.toMatch(/Dato Secreto|secreto@example\.com|999999/);
  });

  it("límite de peticiones: bloquea al pasar el máximo y se reinicia con la ventana", async () => {
    const { getDb, limitesPeticiones, permitirPeticion } = await import("../src/db");
    const { sql } = await import("drizzle-orm");
    const clave = `prueba:${Date.now()}`;

    expect(await permitirPeticion(clave, 2, 60)).toBe(true);
    expect(await permitirPeticion(clave, 2, 60)).toBe(true);
    expect(await permitirPeticion(clave, 2, 60)).toBe(false);
    // Simultáneas: ninguna se salta el conteo.
    const varias = await Promise.all(
      Array.from({ length: 5 }, () => permitirPeticion(`${clave}:b`, 3, 60)),
    );
    expect(varias.filter(Boolean)).toHaveLength(3);

    // Ventana vencida: vuelve a permitir.
    await getDb()
      .update(limitesPeticiones)
      .set({ inicio: sql`now() - interval '2 minutes'` });
    expect(await permitirPeticion(clave, 2, 60)).toBe(true);
    await getDb().delete(limitesPeticiones);
  });
});
