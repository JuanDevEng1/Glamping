// Flujo de pagos con PayPal contra una BD real. Solo corre con DATABASE_URL_PRUEBAS
// (BD de pruebas con migraciones aplicadas; nunca la de producción). La API de PayPal
// y la TRM de datos.gov.co se simulan.
import { eq, inArray, like, or } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/paypal", async (original) => ({
  ...(await original<typeof import("../src/paypal")>()),
  paypalConfigurado: () => true,
  crearOrden: vi.fn(),
  capturarOrden: vi.fn(),
  verificarFirmaWebhook: vi.fn(),
}));

const url = process.env.DATABASE_URL_PRUEBAS;
const TRM = 4000;
const PREFIJO = `WH-PRUEBA-${Date.now()}`;

describe.skipIf(!url)("pagos con PayPal en BD de pruebas", () => {
  const codigosReserva: string[] = [];
  let aliadoId = 0;
  let servicioId = 0;
  let ordenes = 0;
  let eventos = 0;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json([{ valor: String(TRM), vigenciadesde: "2026-01-01T00:00:00.000" }]),
      ),
    );
    const { aliados, configuracion, cuposServicio, getDb, servicios } = await import("../src/db");
    const { hoyEnBogota } = await import("../src/moneda");
    const { sumarDias } = await import("../src/precios");
    const db = getDb();
    await db
      .insert(configuracion)
      .values({ precioBase: 280_000, precioAlto: 350_000, precioPersonaExtra: 60_000 })
      .onConflictDoNothing();
    const [aliado] = await db
      .insert(aliados)
      .values({ nombre: "Aliado pagos", correo: "aliado@example.com" })
      .returning();
    aliadoId = aliado!.id;
    const [servicio] = await db
      .insert(servicios)
      .values({
        slug: `pago-${Date.now()}`,
        aliadoId,
        nombre: "Servicio de pago",
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
      .values({ servicioId, fecha: sumarDias(hoyEnBogota(), 12), turno: "", capacidad: 2 });
  });

  beforeEach(async () => {
    const paypal = await import("../src/paypal");
    vi.mocked(paypal.crearOrden).mockReset();
    vi.mocked(paypal.crearOrden).mockImplementation(async () => ({
      id: `ORD${++ordenes}T${Date.now()}`,
    }));
    vi.mocked(paypal.capturarOrden).mockReset();
    vi.mocked(paypal.verificarFirmaWebhook).mockReset();
    vi.mocked(paypal.verificarFirmaWebhook).mockResolvedValue(true);
  });

  afterAll(async () => {
    const db = await import("../src/db");
    const conn = db.getDb();
    const idsReserva = codigosReserva.length
      ? (
          await conn
            .select({ id: db.reservas.id })
            .from(db.reservas)
            .where(inArray(db.reservas.codigo, codigosReserva))
        ).map((r) => r.id)
      : [];
    const idsPedido = (
      await conn
        .select({ id: db.itemsPedido.pedidoId })
        .from(db.itemsPedido)
        .where(eq(db.itemsPedido.servicioId, servicioId))
    ).map((r) => r.id);
    if (idsReserva.length || idsPedido.length)
      await conn
        .delete(db.pagos)
        .where(
          or(
            idsReserva.length ? inArray(db.pagos.reservaId, idsReserva) : undefined,
            idsPedido.length ? inArray(db.pagos.pedidoId, idsPedido) : undefined,
          ),
        );
    await conn.delete(db.eventosPasarela).where(like(db.eventosPasarela.idEvento, `${PREFIJO}%`));
    if (idsReserva.length)
      await conn.delete(db.reservas).where(inArray(db.reservas.id, idsReserva));
    if (idsPedido.length) await conn.delete(db.pedidos).where(inArray(db.pedidos.id, idsPedido));
    await conn.delete(db.cuposServicio).where(eq(db.cuposServicio.servicioId, servicioId));
    await conn.delete(db.servicios).where(eq(db.servicios.id, servicioId));
    await conn.delete(db.aliados).where(eq(db.aliados.id, aliadoId));
    await conn.$client.end();
    vi.unstubAllGlobals();
  });

  async function nuevaReserva(diasDesdeHoy: number) {
    const { crearReservaPendiente } = await import("../src/reservas");
    const { hoyEnBogota } = await import("../src/moneda");
    const { sumarDias } = await import("../src/precios");
    const llegada = sumarDias(hoyEnBogota(), diasDesdeHoy);
    const r = await crearReservaPendiente({
      estadia: { llegada, salida: sumarDias(llegada, 2), huespedes: 2 },
      huesped: {
        nombre: "Prueba Pagos",
        tipoDocumento: "CC",
        documento: "123456",
        correo: "pagos@example.com",
        telefono: "3000000000",
        pais: "Colombia",
        contactoEmergencia: "Contacto Prueba",
        telefonoEmergencia: "3110000000",
        aceptaTerminos: true,
      },
    });
    if (!r.ok) throw new Error(`no se creó la reserva: ${r.error}`);
    codigosReserva.push(r.codigo);
    return r;
  }

  async function estadoReserva(codigo: string) {
    const { getDb, reservas } = await import("../src/db");
    const [r] = await getDb().select().from(reservas).where(eq(reservas.codigo, codigo));
    return r!;
  }

  async function pagoDe(idOrden: string) {
    const { getDb, pagos } = await import("../src/db");
    const [p] = await getDb().select().from(pagos).where(eq(pagos.idExterno, idOrden));
    return p!;
  }

  function webhook(idOrden: string, valor: string, moneda = "USD") {
    return JSON.stringify({
      id: `${PREFIJO}-${++eventos}`,
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource: {
        id: `CAP${eventos}`,
        status: "COMPLETED",
        amount: { currency_code: moneda, value: valor },
        supplementary_data: { related_ids: { order_id: idOrden } },
      },
    });
  }

  it("crea la orden con el total de la BD convertido a USD y guarda la TRM", async () => {
    const { iniciarPagoPaypal } = await import("../src/pagos");
    const { crearOrden } = await import("../src/paypal");
    const { centavosAValor, copAUsdCentavos } = await import("../src/moneda");
    const reserva = await nuevaReserva(600);
    const { totalCop } = await estadoReserva(reserva.codigo);

    const r = await iniciarPagoPaypal({ tipo: "reserva", codigo: reserva.codigo });
    expect(r.ok).toBe(true);
    const centavos = copAUsdCentavos(totalCop, TRM);
    expect(vi.mocked(crearOrden).mock.calls[0]![0]).toMatchObject({
      referencia: reserva.codigo,
      valor: centavosAValor(centavos),
    });
    const pago = await pagoDe(r.ok ? r.idOrden : "");
    expect(pago).toMatchObject({
      estado: "creado",
      montoCop: totalCop,
      moneda: "USD",
      montoMoneda: centavos,
      trm: "4000.00",
    });
  });

  it("captura sin confirmar; el webhook confirma una sola vez y valida el monto", async () => {
    const { capturarPagoPaypal, iniciarPagoPaypal, procesarWebhookPaypal } =
      await import("../src/pagos");
    const { capturarOrden } = await import("../src/paypal");
    const { getDb, eventosPasarela } = await import("../src/db");
    const reserva = await nuevaReserva(610);
    const inicio = await iniciarPagoPaypal({ tipo: "reserva", codigo: reserva.codigo });
    if (!inicio.ok) throw new Error(inicio.error);
    const pago = await pagoDe(inicio.idOrden);
    const valor = (pago.montoMoneda / 100).toFixed(2);

    vi.mocked(capturarOrden).mockResolvedValue({
      estado: "COMPLETED",
      captura: {
        id: "CAPTURA1",
        status: "COMPLETED",
        amount: { currency_code: "USD", value: valor },
      },
    });
    expect(await capturarPagoPaypal(inicio.idOrden)).toEqual({ ok: true });
    expect((await pagoDe(inicio.idOrden)).estado).toBe("capturado");
    expect((await estadoReserva(reserva.codigo)).estado).toBe("pendiente");

    // Monto distinto: no confirma.
    expect(await procesarWebhookPaypal(new Headers(), webhook(inicio.idOrden, "0.01"))).toBe(200);
    expect((await estadoReserva(reserva.codigo)).estado).toBe("pendiente");

    // Monto correcto: confirma. El mismo evento repetido no tiene efecto.
    const cuerpo = webhook(inicio.idOrden, valor);
    expect(await procesarWebhookPaypal(new Headers(), cuerpo)).toBe(200);
    expect(await procesarWebhookPaypal(new Headers(), cuerpo)).toBe(200);
    const confirmada = await estadoReserva(reserva.codigo);
    expect(confirmada).toMatchObject({ estado: "confirmada", pasarela: "paypal" });
    expect((await pagoDe(inicio.idOrden)).estado).toBe("aprobado");
    const filas = await getDb()
      .select()
      .from(eventosPasarela)
      .where(eq(eventosPasarela.idEvento, JSON.parse(cuerpo).id));
    expect(filas).toHaveLength(1);
  });

  it("firma inválida: 401 y nada cambia", async () => {
    const { iniciarPagoPaypal, procesarWebhookPaypal } = await import("../src/pagos");
    const { verificarFirmaWebhook } = await import("../src/paypal");
    const reserva = await nuevaReserva(620);
    const inicio = await iniciarPagoPaypal({ tipo: "reserva", codigo: reserva.codigo });
    if (!inicio.ok) throw new Error(inicio.error);
    const pago = await pagoDe(inicio.idOrden);

    vi.mocked(verificarFirmaWebhook).mockResolvedValue(false);
    const valor = (pago.montoMoneda / 100).toFixed(2);
    expect(await procesarWebhookPaypal(new Headers(), webhook(inicio.idOrden, valor))).toBe(401);
    expect((await estadoReserva(reserva.codigo)).estado).toBe("pendiente");
  });

  it("hold vencido: no captura (no se cobra)", async () => {
    const { capturarPagoPaypal, iniciarPagoPaypal } = await import("../src/pagos");
    const { capturarOrden } = await import("../src/paypal");
    const { getDb, reservas } = await import("../src/db");
    const { sql } = await import("drizzle-orm");
    const reserva = await nuevaReserva(630);
    const inicio = await iniciarPagoPaypal({ tipo: "reserva", codigo: reserva.codigo });
    if (!inicio.ok) throw new Error(inicio.error);
    await getDb()
      .update(reservas)
      .set({ expiraEn: sql`now() - interval '1 minute'` })
      .where(eq(reservas.codigo, reserva.codigo));

    expect(await capturarPagoPaypal(inicio.idOrden)).toEqual({
      ok: false,
      error: "no_disponible",
    });
    expect(capturarOrden).not.toHaveBeenCalled();
  });

  it("pago tardío con las fechas ya tomadas: queda para reembolso", async () => {
    const { iniciarPagoPaypal, procesarWebhookPaypal } = await import("../src/pagos");
    const { getDb, reservas } = await import("../src/db");
    const { sql } = await import("drizzle-orm");
    const tardia = await nuevaReserva(640);
    const inicio = await iniciarPagoPaypal({ tipo: "reserva", codigo: tardia.codigo });
    if (!inicio.ok) throw new Error(inicio.error);
    await getDb()
      .update(reservas)
      .set({ expiraEn: sql`now() - interval '1 minute'` })
      .where(eq(reservas.codigo, tardia.codigo));
    await nuevaReserva(640); // Otra persona toma las mismas fechas.

    const pago = await pagoDe(inicio.idOrden);
    const valor = (pago.montoMoneda / 100).toFixed(2);
    expect(await procesarWebhookPaypal(new Headers(), webhook(inicio.idOrden, valor))).toBe(200);
    expect((await estadoReserva(tardia.codigo)).estado).toBe("expirada");
    expect((await pagoDe(inicio.idOrden)).estado).toBe("requiere_reembolso");
  });

  it("pedido de servicios: el webhook confirma y pasa los cupos a reservados", async () => {
    const { iniciarPagoPaypal, procesarWebhookPaypal } = await import("../src/pagos");
    const { crearPedidoPendiente } = await import("../src/pedidos");
    const { cuposServicio, getDb, pedidos } = await import("../src/db");
    const { hoyEnBogota } = await import("../src/moneda");
    const { sumarDias } = await import("../src/precios");
    const pedido = await crearPedidoPendiente({
      items: [{ servicioId, fecha: sumarDias(hoyEnBogota(), 12), turno: null, cantidad: 2 }],
      comprador: {
        nombre: "Prueba Pedido",
        correo: "pedido@example.com",
        telefono: "3000000000",
        aceptaTerminos: true,
      },
    });
    if (!pedido.ok) throw new Error(pedido.error);
    const inicio = await iniciarPagoPaypal({ tipo: "pedido", codigo: pedido.codigo });
    if (!inicio.ok) throw new Error(inicio.error);
    const pago = await pagoDe(inicio.idOrden);

    const valor = (pago.montoMoneda / 100).toFixed(2);
    expect(await procesarWebhookPaypal(new Headers(), webhook(inicio.idOrden, valor))).toBe(200);
    const [fila] = await getDb().select().from(pedidos).where(eq(pedidos.codigo, pedido.codigo));
    expect(fila!.estado).toBe("confirmado");
    const [cupo] = await getDb()
      .select()
      .from(cuposServicio)
      .where(eq(cuposServicio.servicioId, servicioId));
    expect(cupo!.reservados).toBe(2);
    expect((await pagoDe(inicio.idOrden)).estado).toBe("aprobado");
  });
});
