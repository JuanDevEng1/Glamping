// Pagos de reservas y pedidos de servicios. La lógica común (montos, holds, idempotencia,
// confirmación en transacción) vive aquí; las llamadas HTTP, en paypal.ts y openpay.ts.
// Reglas (CLAUDE.md): el monto sale de la BD, solo el webhook confirma, el webhook verifica
// la firma (401), es idempotente por id de evento, compara monto y moneda y confirma en una
// transacción; los correos van después del commit.
import { and, desc, eq, gt, inArray, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { correoConfigurado, correosAdmin, enviarCorreo } from "./correos";
import {
  errorSinDatos,
  eventosPasarela,
  getDb,
  obtenerConfiguracion,
  pagos,
  pedidos,
  reservas,
  type Tx,
} from "./db";
import { centavosAValor, copAUsdCentavos, trmParaCobro, valorACentavos } from "./moneda";
import {
  anularAutorizacion,
  autorizarOrden,
  capturarOrden,
  crearOrden,
  ErrorPaypal,
  esquemaEvento,
  paypalConfigurado,
  verificarFirmaWebhook,
  type EventoPaypal,
} from "./paypal";
import {
  crearCargoPse,
  crearCargoTarjeta,
  DIAS_VIGENCIA_PREAUTORIZACION,
  ErrorOpenpay,
  esquemaEventoOpenpay,
  liberarPreautorizacion,
  obtenerCargo,
  openpayConfigurado,
  webhookAutenticado,
  type CargoOpenpay,
} from "./openpay";
import { confirmarPedido } from "./pedidos";
import { confirmarReserva } from "./reservas";

/** Minutos que se extiende el hold al capturar, para que el webhook llegue antes de que venza. */
const MINUTOS_ESPERA_WEBHOOK = 10;

const esquemaDestino = z.union([
  z.object({ tipo: z.literal("reserva"), codigo: z.string().regex(/^LAU-[A-Z0-9]{8}$/) }),
  z.object({ tipo: z.literal("pedido"), codigo: z.string().regex(/^SRV-[A-Z0-9]{8}$/) }),
]);

export type Destino = z.infer<typeof esquemaDestino>;

const tablaDe = (tipo: Destino["tipo"]) => (tipo === "reserva" ? reservas : pedidos);

/** Reserva o pedido pendiente con hold vigente, o null. */
async function cargarPendiente(destino: Destino) {
  const tabla = tablaDe(destino.tipo);
  const [fila] = await getDb()
    .select({
      id: tabla.id,
      totalCop: tabla.totalCop,
      // Openpay pide los datos del cliente: salen de la BD, nunca del navegador.
      nombre: tabla.nombre,
      correo: tabla.correo,
      telefono: tabla.telefono,
    })
    .from(tabla)
    .where(
      and(
        eq(tabla.codigo, destino.codigo),
        eq(tabla.estado, "pendiente"),
        gt(tabla.expiraEn, sql`now()`),
      ),
    )
    .limit(1);
  return fila ?? null;
}

// ---------------------------------------------------------------------------
// Iniciar y capturar (server actions del paso de pago)
// ---------------------------------------------------------------------------

export type ResultadoIniciar =
  | { ok: true; idOrden: string }
  | { ok: false; error: "datos_invalidos" | "no_disponible" | "sin_trm" | "sin_configuracion" }
  | { ok: false; error: "error_pasarela" | "demasiadas_peticiones" | "falta_deposito" };

/** Crea la orden de PayPal por el total guardado en la BD, convertido a USD con la TRM. */
export async function iniciarPagoPaypal(entrada: unknown): Promise<ResultadoIniciar> {
  const destino = esquemaDestino.safeParse(entrada);
  if (!destino.success) return { ok: false, error: "datos_invalidos" };
  if (!process.env.DATABASE_URL || !paypalConfigurado())
    return { ok: false, error: "sin_configuracion" };

  const pendiente = await cargarPendiente(destino.data);
  if (!pendiente) return { ok: false, error: "no_disponible" };
  if (!(await depositoListo(destino.data, pendiente.id, "paypal")))
    return { ok: false, error: "falta_deposito" };
  const trm = await trmParaCobro();
  if (!trm) return { ok: false, error: "sin_trm" };

  const { tipo, codigo } = destino.data;
  const centavos = copAUsdCentavos(pendiente.totalCop, trm.valor);
  let idOrden: string;
  try {
    ({ id: idOrden } = await crearOrden({
      referencia: codigo,
      factura: `${codigo}-${Date.now().toString(36).toUpperCase()}`,
      descripcion:
        tipo === "reserva"
          ? `Reserva ${codigo} · Lauburu Glamping`
          : `Servicios ${codigo} · Lauburu Glamping`,
      valor: centavosAValor(centavos),
    }));
  } catch (error) {
    console.error(`PayPal: no se pudo crear la orden de ${codigo}:`, mensaje(error));
    return { ok: false, error: "error_pasarela" };
  }

  await getDb()
    .insert(pagos)
    .values({
      pasarela: "paypal",
      reservaId: tipo === "reserva" ? pendiente.id : null,
      pedidoId: tipo === "pedido" ? pendiente.id : null,
      idExterno: idOrden,
      montoCop: pendiente.totalCop,
      moneda: "USD",
      montoMoneda: centavos,
      trm: trm.valor.toFixed(2),
    });
  return { ok: true, idOrden };
}

export type ResultadoCapturar =
  | { ok: true }
  | {
      ok: false;
      error:
        | "datos_invalidos"
        | "no_disponible"
        | "rechazado"
        | "error_pasarela"
        | "demasiadas_peticiones";
    };

/**
 * Captura una orden aprobada por el comprador. NO confirma la reserva ni el pedido: eso lo
 * hace el webhook. Si el hold ya venció, no captura (al comprador no se le cobra).
 */
export async function capturarPagoPaypal(idOrden: unknown): Promise<ResultadoCapturar> {
  const id = z.string().regex(/^[A-Z0-9]{1,36}$/).safeParse(idOrden);
  if (!id.success || !process.env.DATABASE_URL) return { ok: false, error: "datos_invalidos" };

  const [pago] = await getDb()
    .select()
    .from(pagos)
    .where(
      and(
        eq(pagos.pasarela, "paypal"),
        eq(pagos.idExterno, id.data),
        eq(pagos.concepto, "cobro"), // Un depósito nunca se captura desde el sitio.
      ),
    )
    .limit(1);
  if (!pago) return { ok: false, error: "datos_invalidos" };
  if (pago.estado !== "creado") return { ok: true };

  const tabla = pago.reservaId ? reservas : pedidos;
  const extendido = await getDb()
    .update(tabla)
    .set({
      expiraEn: sql`greatest(${tabla.expiraEn}, now() + make_interval(mins => ${MINUTOS_ESPERA_WEBHOOK}))`,
    })
    .where(
      and(
        eq(tabla.id, (pago.reservaId ?? pago.pedidoId)!),
        eq(tabla.estado, "pendiente"),
        gt(tabla.expiraEn, sql`now()`),
      ),
    )
    .returning({ id: tabla.id });
  if (extendido.length === 0) return { ok: false, error: "no_disponible" };

  try {
    const { captura } = await capturarOrden(id.data, `captura-${pago.id}`);
    const rechazada = captura?.status === "DECLINED";
    await getDb()
      .update(pagos)
      .set({
        estado: rechazada ? "rechazado" : "capturado",
        idCaptura: captura?.id ?? null,
        actualizadoEn: sql`now()`,
      })
      .where(and(eq(pagos.id, pago.id), eq(pagos.estado, "creado")));
    return rechazada ? { ok: false, error: "rechazado" } : { ok: true };
  } catch (error) {
    if (error instanceof ErrorPaypal && error.issue === "ORDER_ALREADY_CAPTURED")
      return { ok: true };
    if (error instanceof ErrorPaypal && error.issue === "INSTRUMENT_DECLINED")
      return { ok: false, error: "rechazado" };
    console.error(`PayPal: no se pudo capturar el pago ${pago.id}:`, mensaje(error));
    return { ok: false, error: "error_pasarela" };
  }
}

// ---------------------------------------------------------------------------
// Depósito de garantía (autorizar y capturar)
// Se autoriza en el paso de pago, ANTES del cobro, con la misma pasarela: sin depósito
// autorizado no se puede pagar una reserva (depositoListo). La autorización aparta el dinero
// sin cobrarlo y el banco la libera sola al vencer (PayPal 29 días, ver paypal.ts; Openpay
// DIAS_VIGENCIA_PREAUTORIZACION). El admin cobra los daños o la libera desde la pasarela; el
// sitio solo registra el resultado. Nunca confirma ni cambia la reserva.
// ---------------------------------------------------------------------------

/** Depósito vigente: autorizado, o con la autorización pedida a PayPal esperando el webhook. */
const depositoVigente = and(
  eq(pagos.concepto, "deposito"),
  inArray(pagos.estado, ["creado", "autorizado"]),
  isNotNull(pagos.idAutorizacion),
);

/**
 * True si el destino ya se puede pagar: los pedidos no llevan depósito; una reserva necesita
 * un depósito vigente autorizado con la misma pasarela del cobro (si montoDeposito > 0).
 */
async function depositoListo(destino: Destino, id: number, pasarela: "paypal" | "openpay") {
  if (destino.tipo !== "reserva") return true;
  if (((await obtenerConfiguracion())?.montoDeposito ?? 0) <= 0) return true;
  const [vigente] = await getDb()
    .select({ id: pagos.id })
    .from(pagos)
    .where(and(eq(pagos.reservaId, id), eq(pagos.pasarela, pasarela), depositoVigente))
    .limit(1);
  return !!vigente;
}

/**
 * Horas después del vencimiento del hold antes de liberar el depósito de una reserva que no se
 * confirmó: un pago que llega tarde (PSE) todavía puede confirmarla (ver confirmarReserva).
 */
const HORAS_ANTES_DE_LIBERAR = 2;

/**
 * Libera los depósitos de reservas que no se confirmaron (pago fallido, abandonado o
 * cancelado). No hay tareas programadas: se llama después de cada webhook y al crear una
 * reserva. Un depósito que ya venció en el banco se marca anulado sin llamar a la pasarela.
 */
export async function liberarDepositosHuerfanos(limite = 5) {
  if (!process.env.DATABASE_URL) return;
  const filas = await getDb()
    .select({
      id: pagos.id,
      pasarela: pagos.pasarela,
      idAutorizacion: pagos.idAutorizacion,
      vence: pagos.autorizacionVenceEn,
    })
    .from(pagos)
    .innerJoin(reservas, eq(reservas.id, pagos.reservaId))
    .where(
      and(
        depositoVigente,
        ne(reservas.estado, "confirmada"),
        lt(reservas.expiraEn, sql`now() - make_interval(hours => ${HORAS_ANTES_DE_LIBERAR})`),
      ),
    )
    .orderBy(pagos.id)
    .limit(limite);

  for (const fila of filas) {
    const vencido = fila.vence !== null && fila.vence.getTime() < Date.now();
    if (!vencido) {
      try {
        if (fila.pasarela === "openpay") await liberarPreautorizacion(fila.idAutorizacion!);
        else await anularAutorizacion(fila.idAutorizacion!, `anular-${fila.id}`);
      } catch (error) {
        if (!(await yaLiberado(fila.pasarela, fila.idAutorizacion!, error))) {
          console.error(`No se pudo liberar el depósito ${fila.id}:`, mensaje(error));
          continue; // Se reintenta en la próxima llamada.
        }
      }
    }
    await getDb()
      .update(pagos)
      .set({ estado: "anulado", actualizadoEn: sql`now()` })
      .where(and(eq(pagos.id, fila.id), inArray(pagos.estado, ["creado", "autorizado"])));
  }
}

/** La pasarela no dejó liberar porque la autorización ya no está vigente (anulada o vencida). */
async function yaLiberado(pasarela: string, idAutorizacion: string, error: unknown) {
  // PayPal responde 422 si la autorización ya se anuló, venció o se cobró.
  if (pasarela === "paypal") return error instanceof ErrorPaypal && error.status === 422;
  if (!(error instanceof ErrorOpenpay)) return false;
  const cargo = await obtenerCargo(idAutorizacion).catch(() => null);
  return cargo !== null && cargo.status !== "in_progress";
}

export type ResultadoIniciarDeposito =
  | ResultadoIniciar
  | { ok: false; error: "ya_existe" | "sin_deposito" };

/**
 * Crea la orden AUTHORIZE del depósito por `montoDeposito` (de la BD), convertido a USD. Va
 * en el paso de pago, con la reserva pendiente y su hold vigente, antes del cobro.
 */
export async function iniciarDepositoPaypal(entrada: unknown): Promise<ResultadoIniciarDeposito> {
  const codigo = z
    .object({ codigo: z.string().regex(/^LAU-[A-Z0-9]{8}$/) })
    .safeParse(entrada);
  if (!codigo.success) return { ok: false, error: "datos_invalidos" };
  if (!process.env.DATABASE_URL || !paypalConfigurado())
    return { ok: false, error: "sin_configuracion" };

  const montoCop = (await obtenerConfiguracion())?.montoDeposito ?? 0;
  if (montoCop <= 0) return { ok: false, error: "sin_deposito" };
  const destino = { tipo: "reserva", codigo: codigo.data.codigo } as const;
  const reserva = await cargarPendiente(destino);
  if (!reserva || !(await extenderHold(destino, reserva.id, MINUTOS_ESPERA_WEBHOOK)))
    return { ok: false, error: "no_disponible" };

  // Un intento que nunca llegó a autorizarse (el huésped cerró PayPal) se descarta;
  // uno autorizado o en verificación bloquea un depósito nuevo.
  await getDb()
    .update(pagos)
    .set({ estado: "anulado", actualizadoEn: sql`now()` })
    .where(
      and(
        eq(pagos.reservaId, reserva.id),
        eq(pagos.concepto, "deposito"),
        eq(pagos.estado, "creado"),
        isNull(pagos.idAutorizacion),
      ),
    );
  const [vigente] = await getDb()
    .select({ id: pagos.id })
    .from(pagos)
    .where(
      and(
        eq(pagos.reservaId, reserva.id),
        eq(pagos.concepto, "deposito"),
        inArray(pagos.estado, ["creado", "autorizado"]),
      ),
    )
    .limit(1);
  if (vigente) return { ok: false, error: "ya_existe" };

  const trm = await trmParaCobro();
  if (!trm) return { ok: false, error: "sin_trm" };
  const centavos = copAUsdCentavos(montoCop, trm.valor);
  const { codigo: cod } = codigo.data;
  let idOrden: string;
  try {
    ({ id: idOrden } = await crearOrden({
      intent: "AUTHORIZE",
      referencia: cod,
      factura: `${cod}-DEP-${Date.now().toString(36).toUpperCase()}`,
      descripcion: `Depósito de garantía ${cod} · Lauburu Glamping`,
      valor: centavosAValor(centavos),
    }));
  } catch (error) {
    console.error(`PayPal: no se pudo crear el depósito de ${cod}:`, mensaje(error));
    return { ok: false, error: "error_pasarela" };
  }

  try {
    await getDb().insert(pagos).values({
      pasarela: "paypal",
      concepto: "deposito",
      reservaId: reserva.id,
      idExterno: idOrden,
      montoCop,
      moneda: "USD",
      montoMoneda: centavos,
      trm: trm.valor.toFixed(2),
    });
  } catch (error) {
    // Dos clics a la vez: el índice pagos_deposito_vigente deja pasar solo uno.
    if (errorSinDatos("PayPal", error).message.includes("pagos_deposito_vigente"))
      return { ok: false, error: "ya_existe" };
    throw errorSinDatos("PayPal", error);
  }
  return { ok: true, idOrden };
}

/**
 * Autoriza la orden del depósito que el huésped aprobó. Guarda el id y el vencimiento de la
 * autorización, pero NO la marca como autorizada: eso lo hace el webhook (como con los cobros).
 */
export async function autorizarDepositoPaypal(idOrden: unknown): Promise<ResultadoCapturar> {
  const id = z.string().regex(/^[A-Z0-9]{1,36}$/).safeParse(idOrden);
  if (!id.success || !process.env.DATABASE_URL) return { ok: false, error: "datos_invalidos" };

  const [pago] = await getDb()
    .select()
    .from(pagos)
    .where(
      and(
        eq(pagos.pasarela, "paypal"),
        eq(pagos.idExterno, id.data),
        eq(pagos.concepto, "deposito"),
      ),
    )
    .limit(1);
  if (!pago) return { ok: false, error: "datos_invalidos" };
  if (pago.estado !== "creado" || pago.idAutorizacion) return { ok: true };
  // Sin hold vigente no se aparta dinero: la orden aprobada y sin autorizar vence sola.
  const [reserva] = await getDb()
    .select({ codigo: reservas.codigo })
    .from(reservas)
    .where(eq(reservas.id, pago.reservaId!))
    .limit(1);
  const destino = { tipo: "reserva", codigo: reserva?.codigo ?? "" } as const;
  if (!reserva || !(await extenderHold(destino, pago.reservaId!, MINUTOS_ESPERA_WEBHOOK)))
    return { ok: false, error: "no_disponible" };

  try {
    const { autorizacion } = await autorizarOrden(id.data, `autorizacion-${pago.id}`);
    if (!autorizacion || autorizacion.status === "DENIED") return { ok: false, error: "rechazado" };
    await getDb()
      .update(pagos)
      .set({
        idAutorizacion: autorizacion.id,
        autorizacionVenceEn: autorizacion.expiration_time
          ? new Date(autorizacion.expiration_time)
          : null,
        actualizadoEn: sql`now()`,
      })
      .where(and(eq(pagos.id, pago.id), eq(pagos.estado, "creado")));
    return { ok: true };
  } catch (error) {
    if (error instanceof ErrorPaypal && error.issue === "ORDER_ALREADY_AUTHORIZED")
      return { ok: true };
    if (error instanceof ErrorPaypal && error.issue === "INSTRUMENT_DECLINED")
      return { ok: false, error: "rechazado" };
    console.error(`PayPal: no se pudo autorizar el depósito ${pago.id}:`, mensaje(error));
    return { ok: false, error: "error_pasarela" };
  }
}

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

type Confirmacion =
  | { pagoId: number; destino: "reserva" | "pedido"; destinoId: number }
  | { pagoId: number; destino: "deposito"; destinoId: number };

/**
 * Procesa un webhook de PayPal a partir del cuerpo crudo. Devuelve el código HTTP:
 * 401 si la firma no es válida, 400 si el cuerpo no es JSON y 200 en cualquier otro caso
 * (incluidos eventos repetidos o ajenos). Si algo falla, lanza: la ruta responde 500 y
 * PayPal reintenta.
 */
export async function procesarWebhookPaypal(cabeceras: Headers, cuerpo: string) {
  let json: unknown;
  try {
    json = JSON.parse(cuerpo);
  } catch {
    return 400;
  }
  if (!(await verificarFirmaWebhook(cabeceras, json))) return 401;

  const evento = esquemaEvento.safeParse(json);
  if (!evento.success) {
    console.error("PayPal: webhook con formato inesperado");
    return 200;
  }

  const confirmacion = await getDb().transaction(async (tx) => {
    const [nuevo] = await tx
      .insert(eventosPasarela)
      .values({
        pasarela: "paypal",
        idEvento: evento.data.id,
        tipo: evento.data.event_type,
        payload: json,
      })
      .onConflictDoNothing()
      .returning({ id: eventosPasarela.id });
    if (!nuevo) return null; // Evento ya procesado.
    return aplicarEvento(tx, evento.data);
  });

  await despuesDelWebhook(confirmacion);
  return 200;
}

/** Después del commit: si un correo o una liberación falla, lo del webhook ya quedó guardado. */
async function despuesDelWebhook(confirmacion: Confirmacion | null) {
  if (confirmacion?.destino === "deposito" || confirmacion?.destino === "reserva") {
    // El aviso del depósito sale cuando la reserva está pagada y el depósito autorizado, sin
    // importar cuál de los dos webhooks llegue primero.
    await avisarDepositoAutorizado(confirmacion.destinoId).catch((error: unknown) =>
      console.error("Correo de depósito autorizado no enviado:", mensaje(error)),
    );
  }
  // TODO(tarea correos): enviar los correos de confirmación de reservas y pedidos.
  await liberarDepositosHuerfanos().catch((error: unknown) =>
    console.error("No se pudieron liberar depósitos:", mensaje(error)),
  );
}

async function aplicarEvento(tx: Tx, evento: EventoPaypal): Promise<Confirmacion | null> {
  const recurso = evento.resource;
  const relacionados = recurso.supplementary_data?.related_ids;
  const idOrden = relacionados?.order_id;
  const idAutorizacion = relacionados?.authorization_id;
  if (!idOrden && !recurso.id) return null;
  const [pago] = await tx
    .select()
    .from(pagos)
    .where(
      and(
        eq(pagos.pasarela, "paypal"),
        or(
          idOrden ? eq(pagos.idExterno, idOrden) : undefined,
          recurso.id ? eq(pagos.idCaptura, recurso.id) : undefined,
          recurso.id ? eq(pagos.idAutorizacion, recurso.id) : undefined,
          idAutorizacion ? eq(pagos.idAutorizacion, idAutorizacion) : undefined,
        ),
      ),
    )
    .limit(1)
    .for("update");
  if (!pago) {
    if (evento.event_type.startsWith("PAYMENT."))
      console.warn(`PayPal: evento ${evento.id} sin pago asociado`);
    return null;
  }
  if (pago.concepto === "deposito") return aplicarEventoDeposito(tx, evento, pago);

  const actualizar = (estado: (typeof pagos.$inferSelect)["estado"]) =>
    tx
      .update(pagos)
      .set({ estado, idCaptura: recurso.id ?? pago.idCaptura, actualizadoEn: sql`now()` })
      .where(eq(pagos.id, pago.id));

  switch (evento.event_type) {
    case "PAYMENT.CAPTURE.COMPLETED": {
      if (pago.estado === "aprobado" || pago.estado === "requiere_reembolso") return null;
      const monto = recurso.amount;
      if (
        monto?.currency_code !== pago.moneda ||
        valorACentavos(monto.value) !== pago.montoMoneda
      ) {
        console.error(`PayPal: el monto del evento ${evento.id} no coincide con el pago ${pago.id}`);
        return null;
      }
      const resultado = pago.reservaId
        ? await confirmarReserva(tx, pago.reservaId, "paypal")
        : await confirmarPedido(tx, pago.pedidoId!);
      if (resultado === "no_disponible" || resultado === "sin_cupo") {
        await actualizar("requiere_reembolso");
        console.error(`PayPal: el pago ${pago.id} requiere reembolso (${resultado})`);
        return null;
      }
      await actualizar("aprobado");
      return pago.reservaId
        ? { pagoId: pago.id, destino: "reserva", destinoId: pago.reservaId }
        : { pagoId: pago.id, destino: "pedido", destinoId: pago.pedidoId! };
    }
    // La documentación lista DECLINED en Payments v2 y DENIED en v1: se aceptan ambos.
    case "PAYMENT.CAPTURE.DECLINED":
    case "PAYMENT.CAPTURE.DENIED":
      if (pago.estado === "creado" || pago.estado === "capturado") await actualizar("rechazado");
      return null;
    case "PAYMENT.CAPTURE.REFUNDED":
    case "PAYMENT.CAPTURE.REVERSED":
      await actualizar("reembolsado");
      console.warn(`PayPal: el pago ${pago.id} fue reembolsado o revertido; revísalo a mano`);
      return null;
    default:
      return null;
  }
}

/** Eventos de un depósito de garantía. Solo registran el estado: nunca tocan la reserva. */
async function aplicarEventoDeposito(
  tx: Tx,
  evento: EventoPaypal,
  pago: typeof pagos.$inferSelect,
): Promise<Confirmacion | null> {
  const recurso = evento.resource;
  const cambiar = (datos: Partial<typeof pagos.$inferInsert>) =>
    tx
      .update(pagos)
      .set({ ...datos, actualizadoEn: sql`now()` })
      .where(eq(pagos.id, pago.id));
  const vence = recurso.expiration_time ? new Date(recurso.expiration_time) : null;

  switch (evento.event_type) {
    case "PAYMENT.AUTHORIZATION.CREATED": {
      // Reautorización (desde PayPal): nuevo id y vencimiento; el monto puede variar.
      if (pago.estado === "autorizado") {
        await cambiar({ idAutorizacion: recurso.id ?? pago.idAutorizacion, autorizacionVenceEn: vence });
        return null;
      }
      if (pago.estado !== "creado") {
        console.error(
          `PayPal: autorización del depósito ${pago.id} en estado ${pago.estado}; revísala en PayPal`,
        );
        return null;
      }
      const monto = recurso.amount;
      if (
        monto?.currency_code !== pago.moneda ||
        valorACentavos(monto.value) !== pago.montoMoneda
      ) {
        console.error(`PayPal: el monto del evento ${evento.id} no coincide con el depósito ${pago.id}`);
        return null;
      }
      await cambiar({
        estado: "autorizado",
        idAutorizacion: recurso.id ?? pago.idAutorizacion,
        autorizacionVenceEn: vence ?? pago.autorizacionVenceEn,
      });
      return { pagoId: pago.id, destino: "deposito", destinoId: pago.reservaId! };
    }
    case "PAYMENT.AUTHORIZATION.VOIDED":
      // Una autorización anterior a una reautorización no cambia nada.
      if (recurso.id && pago.idAutorizacion && recurso.id !== pago.idAutorizacion) return null;
      if (pago.estado === "creado" || pago.estado === "autorizado")
        await cambiar({ estado: "anulado" });
      return null;
    case "PAYMENT.CAPTURE.COMPLETED": {
      const centavos = recurso.amount ? valorACentavos(recurso.amount.value) : null;
      // Se puede cobrar solo una parte; nunca más de lo autorizado.
      if (
        recurso.amount?.currency_code !== pago.moneda ||
        centavos === null ||
        centavos > pago.montoMoneda
      ) {
        console.error(`PayPal: el cobro del evento ${evento.id} no cuadra con el depósito ${pago.id}`);
        return null;
      }
      await cambiar({ estado: "cobrado", idCaptura: recurso.id ?? pago.idCaptura });
      return null;
    }
    case "PAYMENT.CAPTURE.DECLINED":
    case "PAYMENT.CAPTURE.DENIED":
      console.warn(`PayPal: PayPal rechazó el cobro del depósito ${pago.id}; revísalo en PayPal`);
      return null;
    case "PAYMENT.CAPTURE.REFUNDED":
    case "PAYMENT.CAPTURE.REVERSED":
      await cambiar({ estado: "reembolsado" });
      console.warn(`PayPal: el cobro del depósito ${pago.id} fue reembolsado o revertido`);
      return null;
    default:
      return null;
  }
}

/**
 * Correo al admin: depósito apartado y cómo cobrarlo o liberarlo. Solo sale con la reserva
 * confirmada y su depósito autorizado (antes del pago, la reserva aún puede no completarse).
 */
async function avisarDepositoAutorizado(reservaId: number) {
  const para = correosAdmin();
  if (!correoConfigurado() || para.length === 0) return;
  const [d] = await getDb()
    .select({
      codigo: reservas.codigo,
      nombre: reservas.nombre,
      llegada: reservas.fechaLlegada,
      salida: reservas.fechaSalida,
      montoCop: pagos.montoCop,
      montoMoneda: pagos.montoMoneda,
      vence: pagos.autorizacionVenceEn,
      idAutorizacion: pagos.idAutorizacion,
      pasarela: pagos.pasarela,
    })
    .from(pagos)
    .innerJoin(reservas, eq(reservas.id, pagos.reservaId))
    .where(
      and(
        eq(pagos.reservaId, reservaId),
        eq(pagos.concepto, "deposito"),
        eq(pagos.estado, "autorizado"),
        eq(reservas.estado, "confirmada"),
      ),
    )
    .orderBy(desc(pagos.id))
    .limit(1);
  if (!d) return;
  const cop = new Intl.NumberFormat("es-CO").format(d.montoCop);
  const openpay = d.pasarela === "openpay";
  const vence = d.vence
    ? new Intl.DateTimeFormat("es-CO", { dateStyle: "long", timeZone: "America/Bogota" }).format(
        d.vence,
      )
    : openpay
      ? `en ${DIAS_VIGENCIA_PREAUTORIZACION} días`
      : "en 29 días";
  const instrucciones = openpay
    ? [
        `Monto apartado: $${cop} COP con tarjeta (Openpay). No se ha cobrado.`,
        `La preautorización vence aproximadamente el ${vence} (${DIAS_VIGENCIA_PREAUTORIZACION} días según Openpay; confírmalo con ellos). Después ya no se puede cobrar, aunque la estadía no haya terminado.`,
        `Id del cargo en Openpay: ${d.idAutorizacion ?? "(ver en Openpay)"}`,
        "",
        "Después de la salida, entra al dashboard de Openpay y abre este cargo (aparece como Pendiente):",
        "- Si hubo daños, pulsa Confirmar. Si no te deja poner un monto menor, confirma el total y reembolsa la diferencia.",
        "- Si todo quedó bien, pulsa Reembolsar para liberar el dinero del huésped.",
      ]
    : [
        `Monto apartado: US$ ${centavosAValor(d.montoMoneda)} (≈ $${cop} COP). No se ha cobrado.`,
        `La autorización vence el ${vence}. Después ya no se puede cobrar, aunque la estadía no haya terminado.`,
        `Id de la autorización en PayPal: ${d.idAutorizacion ?? "(ver en PayPal)"}`,
        "",
        "Después de la salida, entra a tu cuenta de PayPal › Actividad y abre esta autorización:",
        "- Si hubo daños, cóbralos (puedes cobrar solo una parte).",
        "- Si todo quedó bien, anúlala para liberar el dinero del huésped.",
        "PayPal garantiza el cobro solo los 3 primeros días; después depende de los fondos del huésped.",
      ];
  await enviarCorreo({
    para,
    asunto: `Depósito de garantía autorizado · ${d.codigo}`,
    texto: [
      `${d.nombre} pagó la reserva ${d.codigo} (del ${d.llegada} al ${d.salida}) y al pagar autorizó el depósito de garantía.`,
      "",
      ...instrucciones,
    ].join("\n"),
  });
}

// ---------------------------------------------------------------------------
// Openpay (pesos colombianos): tarjeta tokenizada en el navegador, PSE y depósito
// preautorizado. El monto sale de la BD; el navegador solo manda el token de la tarjeta y el
// device_session_id del antifraude. Como en PayPal, solo el webhook confirma un cobro.
// ---------------------------------------------------------------------------

/** PSE pasa por el banco y puede tardar más que una tarjeta en avisar. */
const MINUTOS_ESPERA_PSE = 30;

const esquemaTarjeta = z.object({
  token: z.string().regex(/^[A-Za-z0-9]{1,45}$/),
  deviceSessionId: z.string().regex(/^[A-Za-z0-9-]{1,255}$/),
});

export type ResultadoOpenpay =
  | { ok: true }
  | {
      ok: false;
      error:
        | "datos_invalidos"
        | "no_disponible"
        | "sin_configuracion"
        | "rechazado"
        | "requiere_autorizacion_banco"
        | "error_pasarela"
        | "demasiadas_peticiones"
        | "falta_deposito";
    };

/** order_id único por intento (Openpay rechaza repetidos con el error 1006). */
const ordenOpenpay = (codigo: string, sufijo = "") =>
  `${codigo}${sufijo}-${Date.now().toString(36).toUpperCase()}`;

/** Errores de tarjeta de Openpay (3xxx). 3012: el banco pide autorizar el pago. */
function errorTarjeta(error: unknown): ResultadoOpenpay | null {
  if (!(error instanceof ErrorOpenpay) || error.codigo === null) return null;
  if (error.codigo === 3012) return { ok: false, error: "requiere_autorizacion_banco" };
  if (error.codigo >= 3000 && error.codigo < 4000) return { ok: false, error: "rechazado" };
  return null;
}

/** Extiende el hold de una reserva o pedido pendiente. False si ya venció. */
async function extenderHold(destino: Destino, id: number, minutos: number) {
  const tabla = tablaDe(destino.tipo);
  const filas = await getDb()
    .update(tabla)
    .set({ expiraEn: sql`greatest(${tabla.expiraEn}, now() + make_interval(mins => ${minutos}))` })
    .where(and(eq(tabla.id, id), eq(tabla.estado, "pendiente"), gt(tabla.expiraEn, sql`now()`)))
    .returning({ id: tabla.id });
  return filas.length > 0;
}

/**
 * Cobra con una tarjeta tokenizada. Guarda el pago antes de llamar a Openpay para que el
 * webhook lo encuentre aunque llegue antes que la respuesta. NO confirma: eso lo hace el webhook.
 */
export async function pagarConTarjetaOpenpay(entrada: unknown): Promise<ResultadoOpenpay> {
  const datos = z.object({ destino: esquemaDestino }).and(esquemaTarjeta).safeParse(entrada);
  if (!datos.success) return { ok: false, error: "datos_invalidos" };
  if (!process.env.DATABASE_URL || !openpayConfigurado())
    return { ok: false, error: "sin_configuracion" };
  const { destino, token, deviceSessionId } = datos.data;

  const pendiente = await cargarPendiente(destino);
  if (!pendiente || !(await extenderHold(destino, pendiente.id, MINUTOS_ESPERA_WEBHOOK)))
    return { ok: false, error: "no_disponible" };
  if (!(await depositoListo(destino, pendiente.id, "openpay")))
    return { ok: false, error: "falta_deposito" };

  const ordenId = ordenOpenpay(destino.codigo);
  const [pago] = await getDb()
    .insert(pagos)
    .values({
      pasarela: "openpay",
      reservaId: destino.tipo === "reserva" ? pendiente.id : null,
      pedidoId: destino.tipo === "pedido" ? pendiente.id : null,
      idExterno: ordenId,
      montoCop: pendiente.totalCop,
      moneda: "COP",
      montoMoneda: pendiente.totalCop,
    })
    .returning({ id: pagos.id });

  try {
    const cargo = await crearCargoTarjeta({
      token,
      deviceSessionId,
      montoCop: pendiente.totalCop,
      descripcion:
        destino.tipo === "reserva"
          ? `Reserva ${destino.codigo} · Lauburu Glamping`
          : `Servicios ${destino.codigo} · Lauburu Glamping`,
      ordenId,
      cliente: pendiente,
      capturar: true,
    });
    const fallido = cargo.status === "failed";
    await getDb()
      .update(pagos)
      .set({
        estado: fallido ? "rechazado" : cargo.status === "completed" ? "capturado" : "creado",
        idCaptura: cargo.id,
        actualizadoEn: sql`now()`,
      })
      .where(and(eq(pagos.id, pago!.id), eq(pagos.estado, "creado")));
    return fallido ? { ok: false, error: "rechazado" } : { ok: true };
  } catch (error) {
    const deTarjeta = errorTarjeta(error);
    await getDb()
      .update(pagos)
      .set({ estado: "rechazado", actualizadoEn: sql`now()` })
      .where(and(eq(pagos.id, pago!.id), eq(pagos.estado, "creado")));
    if (deTarjeta) return deTarjeta;
    console.error(`Openpay: no se pudo cobrar ${destino.codigo}:`, mensaje(error));
    return { ok: false, error: "error_pasarela" };
  }
}

export type ResultadoPse =
  | { ok: true; urlBanco: string }
  | Exclude<ResultadoOpenpay, { ok: true }>;

/** Crea el cargo PSE y devuelve la URL del banco. `urlRetorno` la arma el servidor. */
export async function iniciarPseOpenpay(entrada: unknown): Promise<ResultadoPse> {
  const datos = z
    .object({ destino: esquemaDestino, urlRetorno: z.string().url() })
    .safeParse(entrada);
  if (!datos.success) return { ok: false, error: "datos_invalidos" };
  if (!process.env.DATABASE_URL || !openpayConfigurado())
    return { ok: false, error: "sin_configuracion" };
  const { destino, urlRetorno } = datos.data;

  const pendiente = await cargarPendiente(destino);
  if (!pendiente) return { ok: false, error: "no_disponible" };
  if (!(await depositoListo(destino, pendiente.id, "openpay")))
    return { ok: false, error: "falta_deposito" };
  if (!(await extenderHold(destino, pendiente.id, MINUTOS_ESPERA_PSE)))
    return { ok: false, error: "no_disponible" };

  const ordenId = ordenOpenpay(destino.codigo, "-PSE");
  await getDb()
    .insert(pagos)
    .values({
      pasarela: "openpay",
      reservaId: destino.tipo === "reserva" ? pendiente.id : null,
      pedidoId: destino.tipo === "pedido" ? pendiente.id : null,
      idExterno: ordenId,
      montoCop: pendiente.totalCop,
      moneda: "COP",
      montoMoneda: pendiente.totalCop,
    });
  try {
    const { urlBanco } = await crearCargoPse({
      montoCop: pendiente.totalCop,
      descripcion:
        destino.tipo === "reserva"
          ? `Reserva ${destino.codigo} · Lauburu Glamping`
          : `Servicios ${destino.codigo} · Lauburu Glamping`,
      ordenId,
      cliente: pendiente,
      urlRetorno,
    });
    return { ok: true, urlBanco };
  } catch (error) {
    await getDb()
      .update(pagos)
      .set({ estado: "rechazado", actualizadoEn: sql`now()` })
      .where(and(eq(pagos.idExterno, ordenId), eq(pagos.pasarela, "openpay")));
    console.error(`Openpay: no se pudo iniciar PSE de ${destino.codigo}:`, mensaje(error));
    return { ok: false, error: "error_pasarela" };
  }
}

/**
 * Depósito de garantía con tarjeta, en el paso de pago y antes del cobro: cargo con
 * capture=false por `montoDeposito` COP. Openpay no garantiza un webhook para la
 * preautorización, así que se marca `autorizado` con la respuesta de la API (llamada
 * autenticada con la llave privada). Un depósito no confirma ni cobra nada.
 */
export async function iniciarDepositoOpenpay(
  entrada: unknown,
): Promise<ResultadoOpenpay | { ok: false; error: "ya_existe" | "sin_deposito" }> {
  const datos = z
    .object({ codigo: z.string().regex(/^LAU-[A-Z0-9]{8}$/) })
    .and(esquemaTarjeta)
    .safeParse(entrada);
  if (!datos.success) return { ok: false, error: "datos_invalidos" };
  if (!process.env.DATABASE_URL || !openpayConfigurado())
    return { ok: false, error: "sin_configuracion" };
  const { codigo, token, deviceSessionId } = datos.data;

  const montoCop = (await obtenerConfiguracion())?.montoDeposito ?? 0;
  if (montoCop <= 0) return { ok: false, error: "sin_deposito" };
  const destino = { tipo: "reserva", codigo } as const;
  const reserva = await cargarPendiente(destino);
  if (!reserva || !(await extenderHold(destino, reserva.id, MINUTOS_ESPERA_WEBHOOK)))
    return { ok: false, error: "no_disponible" };

  // Igual que con PayPal: un intento sin autorizar se descarta; uno vigente bloquea otro.
  await getDb()
    .update(pagos)
    .set({ estado: "anulado", actualizadoEn: sql`now()` })
    .where(
      and(
        eq(pagos.reservaId, reserva.id),
        eq(pagos.concepto, "deposito"),
        eq(pagos.estado, "creado"),
        isNull(pagos.idAutorizacion),
      ),
    );
  const ordenId = ordenOpenpay(codigo, "-DEP");
  let pagoId: number;
  try {
    const [fila] = await getDb()
      .insert(pagos)
      .values({
        pasarela: "openpay",
        concepto: "deposito",
        reservaId: reserva.id,
        idExterno: ordenId,
        montoCop,
        moneda: "COP",
        montoMoneda: montoCop,
      })
      .returning({ id: pagos.id });
    pagoId = fila!.id;
  } catch (error) {
    if (errorSinDatos("Openpay", error).message.includes("pagos_deposito_vigente"))
      return { ok: false, error: "ya_existe" };
    throw errorSinDatos("Openpay", error);
  }

  try {
    const cargo = await crearCargoTarjeta({
      token,
      deviceSessionId,
      montoCop,
      descripcion: `Depósito de garantía ${codigo} · Lauburu Glamping`,
      ordenId,
      cliente: reserva,
      capturar: false,
    });
    if (cargo.status !== "in_progress" || cargo.amount !== montoCop) {
      await getDb()
        .update(pagos)
        .set({ estado: "rechazado", idCaptura: cargo.id, actualizadoEn: sql`now()` })
        .where(eq(pagos.id, pagoId));
      if (cargo.status !== "failed")
        console.error(`Openpay: preautorización ${pagoId} inesperada (${cargo.status}); revísala en Openpay`);
      return { ok: false, error: "rechazado" };
    }
    // El aviso al admin sale cuando el webhook confirme el pago de la reserva.
    await getDb()
      .update(pagos)
      .set({
        estado: "autorizado",
        idAutorizacion: cargo.id,
        autorizacionVenceEn: sql`now() + make_interval(days => ${DIAS_VIGENCIA_PREAUTORIZACION})`,
        actualizadoEn: sql`now()`,
      })
      .where(and(eq(pagos.id, pagoId), eq(pagos.estado, "creado")));
    return { ok: true };
  } catch (error) {
    await getDb()
      .update(pagos)
      .set({ estado: "rechazado", actualizadoEn: sql`now()` })
      .where(and(eq(pagos.id, pagoId), eq(pagos.estado, "creado")));
    const deTarjeta = errorTarjeta(error);
    if (deTarjeta) return deTarjeta;
    console.error(`Openpay: no se pudo preautorizar el depósito de ${codigo}:`, mensaje(error));
    return { ok: false, error: "error_pasarela" };
  }
}

/**
 * Webhook de Openpay. 401 si la autenticación HTTP Basic falla, 400 si el cuerpo no es JSON,
 * 200 en el resto (incluidos eventos repetidos o ajenos). Como Openpay no firma los eventos,
 * el cargo se vuelve a consultar en la API y se decide con esos datos, no con el cuerpo.
 * Si algo falla, lanza: la ruta responde 500 y Openpay reintenta.
 */
export async function procesarWebhookOpenpay(cabeceras: Headers, cuerpo: string) {
  let json: unknown;
  try {
    json = JSON.parse(cuerpo);
  } catch {
    return 400;
  }
  const evento = esquemaEventoOpenpay.safeParse(json);
  if (evento.success && evento.data.type === "verification") {
    // Código de un solo uso para registrar el webhook en el dashboard. Se acepta sin HTTP Basic
    // (Openpay puede mandarlo antes de tener las credenciales): solo se escribe en el log y no
    // cambia nada. Todos los demás eventos exigen autenticación.
    console.info(`Openpay: código de verificación del webhook: ${evento.data.verification_code}`);
    return 200;
  }
  if (!webhookAutenticado(cabeceras)) return 401;
  if (!evento.success) {
    console.error("Openpay: webhook con formato inesperado");
    return 200;
  }
  const idCargo = evento.data.transaction?.id;
  if (!idCargo) return 200;

  const cargo = await obtenerCargo(idCargo);
  const aviso = await getDb().transaction(async (tx) => {
    // Openpay no manda id de evento: la clave es el estado del cargo que ya consultamos.
    const [nuevo] = await tx
      .insert(eventosPasarela)
      .values({
        pasarela: "openpay",
        idEvento: `${evento.data.type}:${cargo.id}:${cargo.status}`,
        tipo: evento.data.type,
        payload: json,
      })
      .onConflictDoNothing()
      .returning({ id: eventosPasarela.id });
    if (!nuevo) return null;
    return aplicarCargoOpenpay(tx, cargo);
  });

  await despuesDelWebhook(aviso);
  return 200;
}

async function aplicarCargoOpenpay(tx: Tx, cargo: CargoOpenpay): Promise<Confirmacion | null> {
  const [pago] = await tx
    .select()
    .from(pagos)
    .where(
      and(
        eq(pagos.pasarela, "openpay"),
        or(
          cargo.order_id ? eq(pagos.idExterno, cargo.order_id) : undefined,
          eq(pagos.idCaptura, cargo.id),
          eq(pagos.idAutorizacion, cargo.id),
        ),
      ),
    )
    .limit(1)
    .for("update");
  if (!pago) {
    console.warn(`Openpay: cargo ${cargo.id} sin pago asociado`);
    return null;
  }
  const cambiar = (datos: Partial<typeof pagos.$inferInsert>) =>
    tx
      .update(pagos)
      .set({ ...datos, actualizadoEn: sql`now()` })
      .where(eq(pagos.id, pago.id));
  if (cargo.currency !== "COP") {
    console.error(`Openpay: el cargo ${cargo.id} no es en COP (pago ${pago.id})`);
    return null;
  }

  if (pago.concepto === "deposito") {
    switch (cargo.status) {
      case "in_progress": // Preautorizado.
        if (pago.estado !== "creado" || cargo.amount !== pago.montoMoneda) return null;
        await cambiar({
          estado: "autorizado",
          idAutorizacion: cargo.id,
          autorizacionVenceEn: new Date(Date.now() + DIAS_VIGENCIA_PREAUTORIZACION * 86_400_000),
        });
        return { pagoId: pago.id, destino: "deposito", destinoId: pago.reservaId! };
      case "completed": // El admin confirmó (total o parcial) desde el dashboard.
        if (cargo.amount > pago.montoMoneda) {
          console.error(`Openpay: el cobro del cargo ${cargo.id} supera el depósito ${pago.id}`);
          return null;
        }
        if (pago.estado === "creado" || pago.estado === "autorizado")
          await cambiar({ estado: "cobrado", idCaptura: cargo.id });
        return null;
      case "cancelled": // Liberado con Reembolsar (o vencido).
        if (pago.estado === "creado" || pago.estado === "autorizado")
          await cambiar({ estado: "anulado" });
        return null;
      case "refunded":
        await cambiar({ estado: "reembolsado" });
        console.warn(`Openpay: el cobro del depósito ${pago.id} fue reembolsado`);
        return null;
      case "failed":
        if (pago.estado === "creado") await cambiar({ estado: "rechazado" });
        return null;
      default:
        return null;
    }
  }

  switch (cargo.status) {
    case "completed": {
      if (pago.estado === "aprobado" || pago.estado === "requiere_reembolso") return null;
      if (cargo.amount !== pago.montoMoneda) {
        console.error(`Openpay: el monto del cargo ${cargo.id} no coincide con el pago ${pago.id}`);
        return null;
      }
      const resultado = pago.reservaId
        ? await confirmarReserva(tx, pago.reservaId, "openpay")
        : await confirmarPedido(tx, pago.pedidoId!);
      if (resultado === "no_disponible" || resultado === "sin_cupo") {
        await cambiar({ estado: "requiere_reembolso", idCaptura: cargo.id });
        console.error(`Openpay: el pago ${pago.id} requiere reembolso (${resultado})`);
        return null;
      }
      await cambiar({ estado: "aprobado", idCaptura: cargo.id });
      return pago.reservaId
        ? { pagoId: pago.id, destino: "reserva", destinoId: pago.reservaId }
        : { pagoId: pago.id, destino: "pedido", destinoId: pago.pedidoId! };
    }
    case "failed":
    case "cancelled":
      if (pago.estado === "creado" || pago.estado === "capturado")
        await cambiar({ estado: "rechazado", idCaptura: cargo.id });
      return null;
    case "refunded":
      await cambiar({ estado: "reembolsado" });
      console.warn(`Openpay: el pago ${pago.id} fue reembolsado; revísalo a mano`);
      return null;
    default:
      // En curso (PSE en el banco, cargo pendiente): solo se guarda el id del cargo.
      if (!pago.idCaptura) await cambiar({ idCaptura: cargo.id });
      return null;
  }
}

/** Mensaje apto para logs: los errores de BD traen parámetros con datos personales. */
function mensaje(error: unknown) {
  if (error instanceof ErrorPaypal || error instanceof ErrorOpenpay) return error.message;
  if (error instanceof Error && !("query" in error) && !("cause" in error && error.cause))
    return error.message;
  return errorSinDatos("Pagos", error).message;
}
