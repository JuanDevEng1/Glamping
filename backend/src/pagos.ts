// Pagos de reservas y pedidos de servicios. La lógica común (montos, holds, idempotencia,
// confirmación en transacción) vive aquí; las llamadas HTTP a PayPal, en paypal.ts.
// Reglas (CLAUDE.md): el monto sale de la BD, solo el webhook confirma, el webhook verifica
// la firma (401), es idempotente por id de evento, compara monto y moneda y confirma en una
// transacción; los correos van después del commit.
import { and, eq, gt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { errorSinDatos, eventosPasarela, getDb, pagos, pedidos, reservas, type Tx } from "./db";
import { centavosAValor, copAUsdCentavos, trmParaCobro, valorACentavos } from "./moneda";
import {
  capturarOrden,
  crearOrden,
  ErrorPaypal,
  esquemaEvento,
  paypalConfigurado,
  verificarFirmaWebhook,
  type EventoPaypal,
} from "./paypal";
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
    .select({ id: tabla.id, totalCop: tabla.totalCop })
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
  | { ok: false; error: "error_pasarela" | "demasiadas_peticiones" };

/** Crea la orden de PayPal por el total guardado en la BD, convertido a USD con la TRM. */
export async function iniciarPagoPaypal(entrada: unknown): Promise<ResultadoIniciar> {
  const destino = esquemaDestino.safeParse(entrada);
  if (!destino.success) return { ok: false, error: "datos_invalidos" };
  if (!process.env.DATABASE_URL || !paypalConfigurado())
    return { ok: false, error: "sin_configuracion" };

  const pendiente = await cargarPendiente(destino.data);
  if (!pendiente) return { ok: false, error: "no_disponible" };
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
    .where(and(eq(pagos.pasarela, "paypal"), eq(pagos.idExterno, id.data)))
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
// Webhook
// ---------------------------------------------------------------------------

type Confirmacion = { pagoId: number; destino: "reserva" | "pedido"; destinoId: number };

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

  if (confirmacion) {
    // TODO(tarea correos): enviar los correos de confirmación (después del commit).
  }
  return 200;
}

async function aplicarEvento(tx: Tx, evento: EventoPaypal): Promise<Confirmacion | null> {
  const recurso = evento.resource;
  const idOrden = recurso.supplementary_data?.related_ids?.order_id;
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
        ),
      ),
    )
    .limit(1)
    .for("update");
  if (!pago) {
    if (evento.event_type.startsWith("PAYMENT.CAPTURE."))
      console.warn(`PayPal: evento ${evento.id} sin pago asociado`);
    return null;
  }

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

/** Mensaje apto para logs: los errores de BD traen parámetros con datos personales. */
function mensaje(error: unknown) {
  if (error instanceof ErrorPaypal) return error.message;
  if (error instanceof Error && !("query" in error) && !("cause" in error && error.cause))
    return error.message;
  return errorSinDatos("PayPal", error).message;
}
