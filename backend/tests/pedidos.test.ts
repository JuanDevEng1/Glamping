// Concurrencia de pedidos contra una BD real. Solo corre con DATABASE_URL_PRUEBAS
// (BD de pruebas con migraciones aplicadas; nunca la de producción).
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.DATABASE_URL_PRUEBAS;

describe.skipIf(!url)("pedidos en BD de pruebas", () => {
  let aliadoId = 0;
  let servicioId = 0;

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
    await db
      .insert(cuposServicio)
      .values({ servicioId, fecha: sumarDias(hoyEnBogota(), 10), turno: "", capacidad: 1 });
  });

  afterAll(async () => {
    const { aliados, cuposServicio, getDb, itemsPedido, pedidos, servicios } =
      await import("../src/db");
    const db = getDb();
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
});
