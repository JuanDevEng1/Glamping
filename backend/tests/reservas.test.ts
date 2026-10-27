// Prueba de concurrencia contra una BD real. Solo corre con DATABASE_URL_PRUEBAS
// (una BD de pruebas con las migraciones aplicadas; nunca la de producción).
import { eq, inArray } from "drizzle-orm";
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
