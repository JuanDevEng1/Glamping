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
});
