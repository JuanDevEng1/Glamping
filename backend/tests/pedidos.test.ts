// Concurrencia de pedidos contra una BD real. Solo corre con DATABASE_URL_PRUEBAS
// (BD de pruebas con migraciones aplicadas; nunca la de producción).
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.DATABASE_URL_PRUEBAS;

describe.skipIf(!url)("pedidos en BD de pruebas", () => {
  let aliadoId = 0;
  let servicioId = 0;
  const codigosReserva: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    const { aliados, cuposServicio, getDb, servicios } = await import("../src/db");
    const { hoyEnBogota } = await import("../src/moneda");
    const { sumarDias } = await import("../src/precios");
    const db = getDb();
    const [aliado] = await db
      .insert(aliados)
      .values({ nombre: "Aliado prueba", correo: "aliado@example.com" })
      .returning();
    aliadoId = aliado!.id;
    const [servicio] = await db
      .insert(servicios)
      .values({
        slug: `prueba-${Date.now()}`,
        aliadoId,
        nombre: "Servicio de prueba",
        categoria: "tours",
        resumen: "Prueba",
        descripcion: "Prueba",
        precio: 50_000,
        unidadPrecio: "persona",
        tipoStock: "cupos",
        turnos: [],
      })
      .returning();
    servicioId = servicio!.id;
    await db.insert(cuposServicio).values([
      { servicioId, fecha: sumarDias(hoyEnBogota(), 10), turno: "", capacidad: 1 },
      { servicioId, fecha: sumarDias(hoyEnBogota(), 11), turno: "", capacidad: 1 },
    ]);
  });

  afterAll(async () => {
    const { aliados, cuposServicio, getDb, itemsPedido, pedidos, reservas, servicios } =
      await import("../src/db");
    const db = getDb();
    if (codigosReserva.length)
      await db.delete(reservas).where(inArray(reservas.codigo, codigosReserva));
    const ids = (
      await db
        .select({ id: itemsPedido.pedidoId })
        .from(itemsPedido)
        .where(eq(itemsPedido.servicioId, servicioId))
    ).map((r) => r.id);
    if (ids.length) await db.delete(pedidos).where(inArray(pedidos.id, ids));
    await db.delete(cuposServicio).where(eq(cuposServicio.servicioId, servicioId));
    await db.delete(servicios).where(eq(servicios.id, servicioId));
    await db.delete(aliados).where(eq(aliados.id, aliadoId));
    await db.$client.end();
  });

  it("dos pedidos simultáneos por el último cupo: solo uno lo aparta", async () => {
    const { crearPedidoPendiente } = await import("../src/pedidos");
    const { hoyEnBogota } = await import("../src/moneda");
    const { sumarDias } = await import("../src/precios");

    const entrada = {
      items: [{ servicioId, fecha: sumarDias(hoyEnBogota(), 10), turno: null, cantidad: 1 }],
      comprador: {
        nombre: "Prueba Pedido",
        correo: "prueba@example.com",
        telefono: "3000000000",
        aceptaTerminos: true,
      },
    };

    const resultados = await Promise.all([
      crearPedidoPendiente(entrada),
      crearPedidoPendiente(entrada),
    ]);
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    expect(resultados.find((r) => !r.ok)).toMatchObject({ ok: false, error: "carrito_invalido" });
  });

  const comprador = {
    nombre: "Prueba Pedido",
    correo: "prueba@example.com",
    telefono: "3000000000",
    aceptaTerminos: true,
  };

  it("vincular reserva: código y correo sin importar mayúsculas; nunca con otro correo o sin pagar", async () => {
    const { configuracion, getDb, reservas } = await import("../src/db");
    const { crearReservaPendiente } = await import("../src/reservas");
    const { vincularReserva } = await import("../src/pedidos");
    const { hoyEnBogota } = await import("../src/moneda");
    const { sumarDias } = await import("../src/precios");

    await getDb()
      .insert(configuracion)
      .values({ precioBase: 280_000, precioAlto: 350_000, precioPersonaExtra: 60_000 })
      .onConflictDoNothing();
    const llegada = sumarDias(hoyEnBogota(), 700);
    const r = await crearReservaPendiente({
      estadia: { llegada, salida: sumarDias(llegada, 2), huespedes: 3 },
      huesped: {
        nombre: "Ana Vinculo",
        tipoDocumento: "CC",
        documento: "123456",
        correo: "Ana.Vinculo@Example.com",
        telefono: "3000000000",
        pais: "Colombia",
        contactoEmergencia: "Contacto Prueba",
        telefonoEmergencia: "3110000000",
        aceptaTerminos: true,
      },
    });
    if (!r.ok) throw new Error(`No se creó la reserva: ${r.error}`);
    codigosReserva.push(r.codigo);

    // Pendiente de pago: no se vincula.
    expect(
      await vincularReserva({ codigo: r.codigo, correo: "ana.vinculo@example.com" }),
    ).toBeNull();

    await getDb()
      .update(reservas)
      .set({ estado: "confirmada" })
      .where(eq(reservas.codigo, r.codigo));
    expect(
      await vincularReserva({
        codigo: r.codigo.toLowerCase(),
        correo: " ANA.VINCULO@example.com ",
      }),
    ).toEqual({
      codigo: r.codigo,
      llegada,
      salida: sumarDias(llegada, 2),
      huespedes: 3,
      nombre: "Ana",
    });
    expect(await vincularReserva({ codigo: r.codigo, correo: "otra@example.com" })).toBeNull();
    expect(
      await vincularReserva({ codigo: "LAU-NOEXISTE", correo: "ana.vinculo@example.com" }),
    ).toBeNull();
    expect(await vincularReserva({ codigo: "cualquier cosa", correo: "no es correo" })).toBeNull();
  });

  it("liberar un pedido devuelve el cupo; un apartado vencido también y queda expirado", async () => {
    const { getDb, pedidos } = await import("../src/db");
    const { crearPedidoPendiente, liberarPedidoPendiente } = await import("../src/pedidos");
    const { hoyEnBogota } = await import("../src/moneda");
    const { sumarDias } = await import("../src/precios");
    const { sql } = await import("drizzle-orm");
    const entrada = {
      items: [{ servicioId, fecha: sumarDias(hoyEnBogota(), 11), turno: null, cantidad: 1 }],
      comprador,
    };

    const primero = await crearPedidoPendiente(entrada);
    if (!primero.ok) throw new Error(`No se creó el pedido: ${primero.error}`);
    expect(await crearPedidoPendiente(entrada)).toMatchObject({
      ok: false,
      error: "carrito_invalido",
    });

    await liberarPedidoPendiente(primero.codigo);
    const segundo = await crearPedidoPendiente(entrada);
    if (!segundo.ok) throw new Error(`No se liberó el cupo: ${segundo.error}`);

    await getDb()
      .update(pedidos)
      .set({ expiraEn: sql`now() - interval '1 minute'` })
      .where(eq(pedidos.codigo, segundo.codigo));
    expect(await crearPedidoPendiente(entrada)).toMatchObject({ ok: true });

    const estados = await getDb()
      .select({ codigo: pedidos.codigo, estado: pedidos.estado })
      .from(pedidos)
      .where(inArray(pedidos.codigo, [primero.codigo, segundo.codigo]));
    expect(Object.fromEntries(estados.map((p) => [p.codigo, p.estado]))).toEqual({
      [primero.codigo]: "cancelado",
      [segundo.codigo]: "expirado",
    });
  });
});
