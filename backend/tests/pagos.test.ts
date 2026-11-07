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
  autorizarOrden: vi.fn(),
  anularAutorizacion: vi.fn(),
  verificarFirmaWebhook: vi.fn(),
}));

vi.mock("../src/openpay", async (original) => ({
  ...(await original<typeof import("../src/openpay")>()),
  openpayConfigurado: () => true,
  crearCargoTarjeta: vi.fn(),
  crearCargoPse: vi.fn(),
  obtenerCargo: vi.fn(),
  liberarPreautorizacion: vi.fn(),
  webhookAutenticado: vi.fn(),
}));

const url = process.env.DATABASE_URL_PRUEBAS;
const TRM = 4000;
const PREFIJO = `WH-PRUEBA-${Date.now()}`;
// Ids de cargos de Openpay únicos por corrida: la clave de idempotencia los incluye.
const OP1 = `${PREFIJO}-OP1`;
const PSE1 = `${PREFIJO}-PSE1`;
const DEP1 = `${PREFIJO}-DEP1`;
const OP2 = `${PREFIJO}-OP2`;

describe.skipIf(!url)("pagos con PayPal en BD de pruebas", () => {
  const codigosReserva: string[] = [];
  let aliadoId = 0;
  let servicioId = 0;
  let ordenes = 0;
  let eventos = 0;
  let depositos = 0;

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
    vi.mocked(paypal.autorizarOrden).mockReset();
    vi.mocked(paypal.anularAutorizacion).mockReset();
    vi.mocked(paypal.verificarFirmaWebhook).mockReset();
    vi.mocked(paypal.verificarFirmaWebhook).mockResolvedValue(true);
    const openpay = await import("../src/openpay");
    vi.mocked(openpay.crearCargoTarjeta).mockReset();
    vi.mocked(openpay.crearCargoPse).mockReset();
    vi.mocked(openpay.obtenerCargo).mockReset();
    vi.mocked(openpay.liberarPreautorizacion).mockReset();
    vi.mocked(openpay.webhookAutenticado).mockReset();
    vi.mocked(openpay.webhookAutenticado).mockReturnValue(true);
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
    await conn.delete(db.eventosPasarela).where(like(db.eventosPasarela.idEvento, `%${PREFIJO}%`));
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

  /** Depósito ya autorizado (atajo para las pruebas que no son del depósito). */
  async function conDeposito(codigo: string, pasarela: "paypal" | "openpay" = "paypal") {
    const { getDb, pagos, reservas } = await import("../src/db");
    const [r] = await getDb().select({ id: reservas.id }).from(reservas).where(eq(reservas.codigo, codigo));
    const n = ++depositos;
    const [fila] = await getDb()
      .insert(pagos)
      .values({
        pasarela,
        concepto: "deposito",
        reservaId: r!.id,
        idExterno: `${PREFIJO}-DEPX${n}`,
        idAutorizacion: `${PREFIJO}-AUTX${n}`,
        autorizacionVenceEn: new Date(Date.now() + 5 * 86_400_000),
        estado: "autorizado",
        montoCop: 100_000,
        moneda: pasarela === "paypal" ? "USD" : "COP",
        montoMoneda: pasarela === "paypal" ? 2500 : 100_000,
        trm: pasarela === "paypal" ? "4000.00" : null,
      })
      .returning();
    return fila!;
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
    await conDeposito(reserva.codigo);
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
    await conDeposito(reserva.codigo);
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
    await conDeposito(reserva.codigo);
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
    await conDeposito(reserva.codigo);
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
    await conDeposito(tardia.codigo);
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

  // -------------------------------------------------------------------------
  // Depósito de garantía (autorizar y capturar)
  // -------------------------------------------------------------------------

  function eventoDeposito(
    tipo: string,
    datos: { idOrden: string; id: string; valor?: string; moneda?: string },
  ) {
    return JSON.stringify({
      id: `${PREFIJO}-${++eventos}`,
      event_type: tipo,
      resource: {
        id: datos.id,
        status: "CREATED",
        expiration_time: "2030-01-01T00:00:00Z",
        ...(datos.valor
          ? { amount: { currency_code: datos.moneda ?? "USD", value: datos.valor } }
          : {}),
        supplementary_data: { related_ids: { order_id: datos.idOrden } },
      },
    });
  }

  it("sin depósito autorizado con la misma pasarela no se puede pagar la reserva", async () => {
    const { iniciarPagoPaypal, iniciarPseOpenpay, pagarConTarjetaOpenpay } =
      await import("../src/pagos");
    const { crearOrden } = await import("../src/paypal");
    const { crearCargoPse, crearCargoTarjeta } = await import("../src/openpay");
    const reserva = await nuevaReserva(650);
    const destino = { tipo: "reserva", codigo: reserva.codigo } as const;
    const falta = { ok: false, error: "falta_deposito" };

    expect(await iniciarPagoPaypal(destino)).toEqual(falta);
    expect(
      await pagarConTarjetaOpenpay({ destino, token: "tok", deviceSessionId: "ds" }),
    ).toEqual(falta);
    expect(await iniciarPseOpenpay({ destino, urlRetorno: "https://lauburu.example/r" })).toEqual(
      falta,
    );
    // Un depósito de PayPal no habilita el pago con Openpay.
    await conDeposito(reserva.codigo, "paypal");
    expect(
      await pagarConTarjetaOpenpay({ destino, token: "tok", deviceSessionId: "ds" }),
    ).toEqual(falta);
    expect(crearOrden).not.toHaveBeenCalled();
    expect(crearCargoTarjeta).not.toHaveBeenCalled();
    expect(crearCargoPse).not.toHaveBeenCalled();
  });

  it("depósito: solo con la reserva pendiente y su hold vigente", async () => {
    const { iniciarDepositoOpenpay, iniciarDepositoPaypal } = await import("../src/pagos");
    const { crearOrden } = await import("../src/paypal");
    const { crearCargoTarjeta } = await import("../src/openpay");
    const { getDb, reservas } = await import("../src/db");
    const { sql } = await import("drizzle-orm");
    const reserva = await nuevaReserva(655);
    await getDb()
      .update(reservas)
      .set({ expiraEn: sql`now() - interval '1 minute'` })
      .where(eq(reservas.codigo, reserva.codigo));
    const noDisponible = { ok: false, error: "no_disponible" };
    expect(await iniciarDepositoPaypal({ codigo: reserva.codigo })).toEqual(noDisponible);
    expect(
      await iniciarDepositoOpenpay({ codigo: reserva.codigo, token: "tok", deviceSessionId: "ds" }),
    ).toEqual(noDisponible);
    expect(crearOrden).not.toHaveBeenCalled();
    expect(crearCargoTarjeta).not.toHaveBeenCalled();
  });

  it("depósito: orden AUTHORIZE por el monto de la BD antes del pago; el webhook lo marca sin tocar la reserva", async () => {
    const {
      autorizarDepositoPaypal,
      iniciarDepositoPaypal,
      iniciarPagoPaypal,
      procesarWebhookPaypal,
    } = await import("../src/pagos");
    const { autorizarOrden, crearOrden } = await import("../src/paypal");
    const { centavosAValor, copAUsdCentavos } = await import("../src/moneda");
    const { obtenerReservaPublica } = await import("../src/reservas");
    const reserva = await nuevaReserva(5);

    const inicio = await iniciarDepositoPaypal({ codigo: reserva.codigo });
    if (!inicio.ok) throw new Error(inicio.error);
    const centavos = copAUsdCentavos(100_000, TRM);
    expect(vi.mocked(crearOrden).mock.calls[0]![0]).toMatchObject({
      intent: "AUTHORIZE",
      referencia: reserva.codigo,
      valor: centavosAValor(centavos),
    });
    expect(await pagoDe(inicio.idOrden)).toMatchObject({
      concepto: "deposito",
      estado: "creado",
      montoCop: 100_000,
      montoMoneda: centavos,
    });

    // Autorizar guarda el id, pero el estado lo cambia solo el webhook.
    vi.mocked(autorizarOrden).mockResolvedValue({
      estado: "COMPLETED",
      autorizacion: {
        id: "AUT1",
        status: "CREATED",
        amount: { currency_code: "USD", value: centavosAValor(centavos) },
        expiration_time: "2030-01-01T00:00:00Z",
      },
    });
    expect(await autorizarDepositoPaypal(inicio.idOrden)).toEqual({ ok: true });
    expect(await pagoDe(inicio.idOrden)).toMatchObject({ estado: "creado", idAutorizacion: "AUT1" });
    expect((await obtenerReservaPublica(reserva.codigo))!.deposito!.estado).toBe("verificando");
    // Con la autorización pedida ya se puede pagar.
    expect((await iniciarPagoPaypal({ tipo: "reserva", codigo: reserva.codigo })).ok).toBe(true);

    // Monto distinto: no autoriza.
    const distinto = eventoDeposito("PAYMENT.AUTHORIZATION.CREATED", {
      idOrden: inicio.idOrden,
      id: "AUT1",
      valor: "0.01",
    });
    expect(await procesarWebhookPaypal(new Headers(), distinto)).toBe(200);
    expect((await pagoDe(inicio.idOrden)).estado).toBe("creado");

    const creada = eventoDeposito("PAYMENT.AUTHORIZATION.CREATED", {
      idOrden: inicio.idOrden,
      id: "AUT1",
      valor: centavosAValor(centavos),
    });
    expect(await procesarWebhookPaypal(new Headers(), creada)).toBe(200);
    expect(await procesarWebhookPaypal(new Headers(), creada)).toBe(200);
    expect((await pagoDe(inicio.idOrden)).estado).toBe("autorizado");
    expect((await estadoReserva(reserva.codigo)).estado).toBe("pendiente");
    expect((await obtenerReservaPublica(reserva.codigo))!.deposito).toMatchObject({
      estado: "autorizado",
      venceEn: "2030-01-01T00:00:00.000Z",
    });

    // No se puede pedir un segundo depósito.
    expect(await iniciarDepositoPaypal({ codigo: reserva.codigo })).toEqual({
      ok: false,
      error: "ya_existe",
    });

    // El admin cobra una parte desde PayPal: queda cobrado y la reserva no cambia.
    const cobro = JSON.stringify({
      id: `${PREFIJO}-${++eventos}`,
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource: {
        id: `CAPDEP${eventos}`,
        status: "COMPLETED",
        amount: { currency_code: "USD", value: "5.00" },
        supplementary_data: {
          related_ids: { order_id: inicio.idOrden, authorization_id: "AUT1" },
        },
      },
    });
    expect(await procesarWebhookPaypal(new Headers(), cobro)).toBe(200);
    expect((await pagoDe(inicio.idOrden)).estado).toBe("cobrado");
    expect((await estadoReserva(reserva.codigo)).estado).toBe("pendiente");
  });

  it("depósito: un intento abandonado se descarta y la anulación lo libera", async () => {
    const { iniciarDepositoPaypal, procesarWebhookPaypal } = await import("../src/pagos");
    const { centavosAValor } = await import("../src/moneda");
    const reserva = await nuevaReserva(7);

    const abandonado = await iniciarDepositoPaypal({ codigo: reserva.codigo });
    if (!abandonado.ok) throw new Error(abandonado.error);
    const nuevo = await iniciarDepositoPaypal({ codigo: reserva.codigo });
    if (!nuevo.ok) throw new Error(nuevo.error);
    expect((await pagoDe(abandonado.idOrden)).estado).toBe("anulado");

    const pago = await pagoDe(nuevo.idOrden);
    const creada = eventoDeposito("PAYMENT.AUTHORIZATION.CREATED", {
      idOrden: nuevo.idOrden,
      id: "AUT2",
      valor: centavosAValor(pago.montoMoneda),
    });
    expect(await procesarWebhookPaypal(new Headers(), creada)).toBe(200);
    expect((await pagoDe(nuevo.idOrden)).estado).toBe("autorizado");

    const anulada = eventoDeposito("PAYMENT.AUTHORIZATION.VOIDED", {
      idOrden: nuevo.idOrden,
      id: "AUT2",
    });
    expect(await procesarWebhookPaypal(new Headers(), anulada)).toBe(200);
    expect((await pagoDe(nuevo.idOrden)).estado).toBe("anulado");
    expect((await estadoReserva(reserva.codigo)).estado).toBe("pendiente");
  });

  it("depósitos huérfanos: se liberan 2 horas después de vencer el hold, nunca los de reservas pagadas", async () => {
    const { liberarDepositosHuerfanos } = await import("../src/pagos");
    const { anularAutorizacion } = await import("../src/paypal");
    const { ErrorOpenpay, liberarPreautorizacion, obtenerCargo } = await import("../src/openpay");
    const { getDb, pagos, reservas } = await import("../src/db");
    const { sql } = await import("drizzle-orm");
    const vencer = (codigo: string, intervalo: string) =>
      getDb()
        .update(reservas)
        .set({ expiraEn: sql`now() - ${intervalo}::interval` })
        .where(eq(reservas.codigo, codigo));
    const estadoPago = async (id: number) =>
      (await getDb().select().from(pagos).where(eq(pagos.id, id)))[0]!.estado;

    const abandonada = await nuevaReserva(560);
    const reciente = await nuevaReserva(565);
    const pagada = await nuevaReserva(570);
    const yaCancelada = await nuevaReserva(575);
    const depAbandonada = await conDeposito(abandonada.codigo, "paypal");
    const depReciente = await conDeposito(reciente.codigo, "openpay");
    const depPagada = await conDeposito(pagada.codigo, "openpay");
    const depCancelada = await conDeposito(yaCancelada.codigo, "openpay");
    await vencer(abandonada.codigo, "3 hours");
    await vencer(reciente.codigo, "1 minute"); // Un PSE tardío aún podría confirmarla.
    await vencer(pagada.codigo, "3 hours");
    await vencer(yaCancelada.codigo, "3 hours");
    await getDb()
      .update(reservas)
      .set({ estado: "confirmada" })
      .where(eq(reservas.codigo, pagada.codigo));
    // Openpay no deja reembolsar porque la preautorización ya se liberó: se marca igual.
    vi.mocked(liberarPreautorizacion).mockRejectedValue(new ErrorOpenpay(409, 1003));
    vi.mocked(obtenerCargo).mockResolvedValue({
      id: depCancelada.idAutorizacion!,
      status: "cancelled",
      amount: 100_000,
      currency: "COP",
    });

    await liberarDepositosHuerfanos(100);
    expect(anularAutorizacion).toHaveBeenCalledWith(
      depAbandonada.idAutorizacion,
      `anular-${depAbandonada.id}`,
    );
    expect(liberarPreautorizacion).toHaveBeenCalledWith(depCancelada.idAutorizacion);
    expect(await estadoPago(depAbandonada.id)).toBe("anulado");
    expect(await estadoPago(depCancelada.id)).toBe("anulado");
    expect(await estadoPago(depReciente.id)).toBe("autorizado");
    expect(await estadoPago(depPagada.id)).toBe("autorizado");
  });

  // -------------------------------------------------------------------------
  // Openpay (COP): tarjeta, PSE y depósito preautorizado
  // -------------------------------------------------------------------------

  async function pagoOpenpayDe(reservaCodigo: string, concepto: "cobro" | "deposito" = "cobro") {
    const { getDb, pagos, reservas } = await import("../src/db");
    const { and, desc } = await import("drizzle-orm");
    const [p] = await getDb()
      .select({ pago: pagos })
      .from(pagos)
      .innerJoin(reservas, eq(reservas.id, pagos.reservaId))
      .where(
        and(
          eq(reservas.codigo, reservaCodigo),
          eq(pagos.pasarela, "openpay"),
          eq(pagos.concepto, concepto),
        ),
      )
      .orderBy(desc(pagos.id))
      .limit(1);
    return p!.pago;
  }

  /** Cargo de Openpay como lo devuelve GET /charges/{id}. */
  function cargo(datos: { id: string; status: string; amount: number; order_id: string }) {
    return { ...datos, currency: "COP", method: "card" };
  }

  function eventoOpenpay(id: string, tipo = "charge.succeeded") {
    return JSON.stringify({
      type: tipo,
      event_date: "2026-11-05T10:00:00-05:00",
      transaction: { id, status: "completed" },
    });
  }

  it("Openpay tarjeta: cobra en COP sin TRM; solo el webhook (con el cargo consultado) confirma", async () => {
    const { pagarConTarjetaOpenpay, procesarWebhookOpenpay } = await import("../src/pagos");
    const { crearCargoTarjeta, obtenerCargo, webhookAutenticado } = await import("../src/openpay");
    const reserva = await nuevaReserva(660);
    await conDeposito(reserva.codigo, "openpay");
    const { totalCop } = await estadoReserva(reserva.codigo);

    vi.mocked(crearCargoTarjeta).mockImplementation(async (d) =>
      cargo({ id: OP1, status: "completed", amount: d.montoCop, order_id: d.ordenId }),
    );
    expect(
      await pagarConTarjetaOpenpay({
        destino: { tipo: "reserva", codigo: reserva.codigo },
        token: "tok123",
        deviceSessionId: "dsid123",
      }),
    ).toEqual({ ok: true });
    expect(vi.mocked(crearCargoTarjeta).mock.calls[0]![0]).toMatchObject({
      montoCop: totalCop,
      capturar: true,
      cliente: { correo: "pagos@example.com" },
    });
    const pago = await pagoOpenpayDe(reserva.codigo);
    expect(pago).toMatchObject({
      estado: "capturado",
      moneda: "COP",
      montoMoneda: totalCop,
      trm: null,
      idCaptura: OP1,
    });
    expect((await estadoReserva(reserva.codigo)).estado).toBe("pendiente");

    // Sin autenticación válida: 401 y nada cambia.
    vi.mocked(webhookAutenticado).mockReturnValue(false);
    expect(await procesarWebhookOpenpay(new Headers(), eventoOpenpay(OP1))).toBe(401);
    vi.mocked(webhookAutenticado).mockReturnValue(true);

    // El cuerpo dice completed, pero la API dice otro monto: no confirma.
    vi.mocked(obtenerCargo).mockResolvedValue(
      cargo({ id: OP1, status: "completed", amount: totalCop - 1, order_id: pago.idExterno }),
    );
    expect(await procesarWebhookOpenpay(new Headers(), eventoOpenpay(OP1))).toBe(200);
    expect((await estadoReserva(reserva.codigo)).estado).toBe("pendiente");

    // Monto correcto: confirma una sola vez.
    vi.mocked(obtenerCargo).mockResolvedValue(
      cargo({ id: OP1, status: "completed", amount: totalCop, order_id: pago.idExterno }),
    );
    const evento = eventoOpenpay(OP1, "charge.created");
    expect(await procesarWebhookOpenpay(new Headers(), evento)).toBe(200);
    expect(await procesarWebhookOpenpay(new Headers(), evento)).toBe(200);
    expect(await estadoReserva(reserva.codigo)).toMatchObject({
      estado: "confirmada",
      pasarela: "openpay",
    });
    expect((await pagoOpenpayDe(reserva.codigo)).estado).toBe("aprobado");
  });

  it("Openpay tarjeta rechazada: no cobra ni confirma", async () => {
    const { pagarConTarjetaOpenpay } = await import("../src/pagos");
    const { crearCargoTarjeta, ErrorOpenpay } = await import("../src/openpay");
    const reserva = await nuevaReserva(670);
    await conDeposito(reserva.codigo, "openpay");
    vi.mocked(crearCargoTarjeta).mockRejectedValue(new ErrorOpenpay(402, 3001));
    expect(
      await pagarConTarjetaOpenpay({
        destino: { tipo: "reserva", codigo: reserva.codigo },
        token: "tok123",
        deviceSessionId: "dsid123",
      }),
    ).toEqual({ ok: false, error: "rechazado" });
    expect((await pagoOpenpayDe(reserva.codigo)).estado).toBe("rechazado");
  });

  it("Openpay PSE: devuelve la URL del banco y confirma cuando la API dice completed", async () => {
    const { iniciarPseOpenpay, procesarWebhookOpenpay } = await import("../src/pagos");
    const { crearCargoPse, obtenerCargo } = await import("../src/openpay");
    const reserva = await nuevaReserva(680);
    await conDeposito(reserva.codigo, "openpay");
    const { totalCop } = await estadoReserva(reserva.codigo);
    vi.mocked(crearCargoPse).mockResolvedValue({ urlBanco: "https://banco.example/pse" });

    const r = await iniciarPseOpenpay({
      destino: { tipo: "reserva", codigo: reserva.codigo },
      urlRetorno: `https://lauburu.example/reservas/confirmacion/${reserva.codigo}`,
    });
    expect(r).toEqual({ ok: true, urlBanco: "https://banco.example/pse" });
    const pago = await pagoOpenpayDe(reserva.codigo);

    // En el banco: solo guarda el id del cargo.
    vi.mocked(obtenerCargo).mockResolvedValue(
      cargo({ id: PSE1, status: "in_progress", amount: totalCop, order_id: pago.idExterno }),
    );
    expect(await procesarWebhookOpenpay(new Headers(), eventoOpenpay(PSE1, "charge.created"))).toBe(200);
    expect((await pagoOpenpayDe(reserva.codigo)).idCaptura).toBe(PSE1);
    expect((await estadoReserva(reserva.codigo)).estado).toBe("pendiente");

    vi.mocked(obtenerCargo).mockResolvedValue(
      cargo({ id: PSE1, status: "completed", amount: totalCop, order_id: pago.idExterno }),
    );
    expect(await procesarWebhookOpenpay(new Headers(), eventoOpenpay(PSE1))).toBe(200);
    expect((await estadoReserva(reserva.codigo)).estado).toBe("confirmada");
  });

  it("Openpay depósito: capture=false antes del pago; luego se paga y el cobro parcial queda cobrado", async () => {
    const { iniciarDepositoOpenpay, pagarConTarjetaOpenpay, procesarWebhookOpenpay } =
      await import("../src/pagos");
    const { crearCargoTarjeta, obtenerCargo } = await import("../src/openpay");
    const { obtenerReservaPublica } = await import("../src/reservas");
    const reserva = await nuevaReserva(2);
    const { totalCop } = await estadoReserva(reserva.codigo);

    vi.mocked(crearCargoTarjeta).mockImplementation(async (d) =>
      cargo({ id: DEP1, status: "in_progress", amount: d.montoCop, order_id: d.ordenId }),
    );
    expect(
      await iniciarDepositoOpenpay({ codigo: reserva.codigo, token: "tok", deviceSessionId: "ds" }),
    ).toEqual({ ok: true });
    expect(vi.mocked(crearCargoTarjeta).mock.calls[0]![0]).toMatchObject({
      montoCop: 100_000,
      capturar: false,
    });
    const deposito = await pagoOpenpayDe(reserva.codigo, "deposito");
    expect(deposito).toMatchObject({
      estado: "autorizado",
      idAutorizacion: DEP1,
      moneda: "COP",
      montoMoneda: 100_000,
    });
    expect((await obtenerReservaPublica(reserva.codigo))!.deposito).toMatchObject({
      pasarela: "openpay",
      estado: "autorizado",
    });
    expect((await estadoReserva(reserva.codigo)).estado).toBe("pendiente");

    // Con el depósito autorizado se paga; el webhook confirma la reserva.
    vi.mocked(crearCargoTarjeta).mockImplementation(async (d) =>
      cargo({ id: OP2, status: "completed", amount: d.montoCop, order_id: d.ordenId }),
    );
    expect(
      await pagarConTarjetaOpenpay({
        destino: { tipo: "reserva", codigo: reserva.codigo },
        token: "tok2",
        deviceSessionId: "ds",
      }),
    ).toEqual({ ok: true });
    const pago = await pagoOpenpayDe(reserva.codigo);
    vi.mocked(obtenerCargo).mockResolvedValue(
      cargo({ id: OP2, status: "completed", amount: totalCop, order_id: pago.idExterno }),
    );
    expect(await procesarWebhookOpenpay(new Headers(), eventoOpenpay(OP2))).toBe(200);
    expect((await estadoReserva(reserva.codigo)).estado).toBe("confirmada");

    // El admin confirma 40.000 desde el dashboard: cobrado, la reserva no cambia.
    vi.mocked(obtenerCargo).mockResolvedValue(
      cargo({ id: DEP1, status: "completed", amount: 40_000, order_id: deposito.idExterno }),
    );
    expect(await procesarWebhookOpenpay(new Headers(), eventoOpenpay(DEP1))).toBe(200);
    expect((await pagoOpenpayDe(reserva.codigo, "deposito")).estado).toBe("cobrado");
    expect((await estadoReserva(reserva.codigo)).estado).toBe("confirmada");
  });
});
