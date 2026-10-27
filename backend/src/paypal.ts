// Cliente HTTP mínimo de la API REST de PayPal (sin SDK: fetch + Zod).
// Documentación oficial consultada el 2026-10-26:
// - Autenticación («Step result»): https://developer.paypal.com/api/rest/authentication/
// - Orders v2, crear orden («Request Body», «Header Parameters»):
//   https://developer.paypal.com/api/orders/v2/orders-create
// - Orders v2, capturar: https://developer.paypal.com/api/orders/v2/orders-capture
// - Errores de Orders v2: https://developer.paypal.com/api/rest/reference/orders/v2/errors/
// - Verificar firma de webhook (postback):
//   https://developer.paypal.com/api/webhooks/v1/verify-webhook-signature-post
// - Objeto captura (supplementary_data.related_ids.order_id):
//   https://developer.paypal.com/api/payments/v2/captures-get
import { randomUUID } from "node:crypto";
import { z } from "zod";

function config() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secreto = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !secreto) throw new Error("Faltan PAYPAL_CLIENT_ID o PAYPAL_CLIENT_SECRET");
  const base =
    process.env.PAYPAL_ENTORNO === "live"
      ? "https://api-m.paypal.com"
      : "https://api-m.sandbox.paypal.com";
  return { clientId, secreto, base };
}

/** PayPal se ofrece solo si las credenciales del servidor están configuradas. */
export function paypalConfigurado() {
  return !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

export type ClientePaypal = { clientId: string; entorno: "sandbox" | "live" };

/** Datos públicos para el SDK del navegador (el client ID no es secreto), o null. */
export function clientePaypal(): ClientePaypal | null {
  if (!paypalConfigurado()) return null;
  return {
    clientId: process.env.PAYPAL_CLIENT_ID!,
    entorno: process.env.PAYPAL_ENTORNO === "live" ? "live" : "sandbox",
  };
}

export class ErrorPaypal extends Error {
  constructor(
    readonly status: number,
    /** `details[0].issue` de la respuesta, ej. INSTRUMENT_DECLINED u ORDER_ALREADY_CAPTURED. */
    readonly issue: string | null,
  ) {
    super(`PayPal respondió ${status}${issue ? ` (${issue})` : ""}`);
  }
}

// ---------------------------------------------------------------------------
// Token OAuth (client_credentials), en memoria hasta poco antes de `expires_in`.
// ---------------------------------------------------------------------------

const respuestaToken = z.object({ access_token: z.string(), expires_in: z.number() });
let token: { valor: string; venceEn: number } | null = null;

async function obtenerToken() {
  if (token && token.venceEn > Date.now()) return token.valor;
  const { clientId, secreto, base } = config();
  const res = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${secreto}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new ErrorPaypal(res.status, null);
  const datos = respuestaToken.parse(await res.json());
  token = { valor: datos.access_token, venceEn: Date.now() + (datos.expires_in - 60) * 1000 };
  return token.valor;
}

const respuestaError = z.object({
  details: z.array(z.object({ issue: z.string() })).optional(),
});

async function llamar(ruta: string, cuerpo: unknown, idSolicitud?: string) {
  const { base } = config();
  const res = await fetch(`${base}${ruta}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await obtenerToken()}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(idSolicitud ? { "PayPal-Request-Id": idSolicitud } : {}),
    },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(15_000),
  });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = respuestaError.safeParse(json);
    throw new ErrorPaypal(res.status, error.data?.details?.[0]?.issue ?? null);
  }
  return json;
}

// ---------------------------------------------------------------------------
// Órdenes
// ---------------------------------------------------------------------------

const respuestaOrden = z.object({
  id: z.string(),
  status: z.string(),
  purchase_units: z
    .array(
      z.object({
        payments: z
          .object({
            captures: z
              .array(
                z.object({
                  id: z.string(),
                  status: z.string(),
                  amount: z.object({ currency_code: z.string(), value: z.string() }),
                }),
              )
              .optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});

/** Crea una orden CAPTURE por `valor` USD (ej. "123.45"). `referencia` es el código LAU-/SRV-. */
export async function crearOrden(datos: {
  referencia: string;
  /** Único por comercio (PayPal rechaza invoice_id repetidos). */
  factura: string;
  descripcion: string;
  valor: string;
}) {
  const orden = respuestaOrden.parse(
    await llamar(
      "/v2/checkout/orders",
      {
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: datos.referencia,
            custom_id: datos.referencia,
            invoice_id: datos.factura,
            description: datos.descripcion,
            amount: { currency_code: "USD", value: datos.valor },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              brand_name: "Lauburu Glamping",
              shipping_preference: "NO_SHIPPING",
              user_action: "PAY_NOW",
            },
          },
        },
      },
      randomUUID(),
    ),
  );
  return { id: orden.id };
}

/** Captura una orden aprobada. Repetir con el mismo `idSolicitud` no cobra dos veces. */
export async function capturarOrden(idOrden: string, idSolicitud: string) {
  const orden = respuestaOrden.parse(
    await llamar(`/v2/checkout/orders/${encodeURIComponent(idOrden)}/capture`, {}, idSolicitud),
  );
  const captura = orden.purchase_units?.[0]?.payments?.captures?.[0] ?? null;
  return { estado: orden.status, captura };
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

/** Evento de webhook. `resource` es el objeto captura en los eventos PAYMENT.CAPTURE.*. */
export const esquemaEvento = z.object({
  id: z.string().min(1),
  event_type: z.string(),
  resource: z
    .object({
      id: z.string().optional(),
      status: z.string().optional(),
      custom_id: z.string().optional(),
      amount: z.object({ currency_code: z.string(), value: z.string() }).optional(),
      supplementary_data: z
        .object({ related_ids: z.object({ order_id: z.string().optional() }).optional() })
        .optional(),
    })
    .loose(),
});

export type EventoPaypal = z.infer<typeof esquemaEvento>;

const CABECERAS_FIRMA = {
  auth_algo: "paypal-auth-algo",
  cert_url: "paypal-cert-url",
  transmission_id: "paypal-transmission-id",
  transmission_sig: "paypal-transmission-sig",
  transmission_time: "paypal-transmission-time",
} as const;

/**
 * Verifica la firma con el endpoint de postback de PayPal. El evento se reenvía tal cual
 * llegó (objeto parseado del cuerpo crudo, sin transformar). No funciona con eventos simulados.
 */
export async function verificarFirmaWebhook(cabeceras: Headers, evento: unknown) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) throw new Error("Falta PAYPAL_WEBHOOK_ID");
  const campos: Record<string, string> = {};
  for (const [campo, cabecera] of Object.entries(CABECERAS_FIRMA)) {
    const valor = cabeceras.get(cabecera);
    if (!valor) return false;
    campos[campo] = valor;
  }
  const respuesta = z
    .object({ verification_status: z.string() })
    .safeParse(
      await llamar("/v1/notifications/verify-webhook-signature", {
        ...campos,
        webhook_id: webhookId,
        webhook_event: evento,
      }),
    );
  return respuesta.success && respuesta.data.verification_status === "SUCCESS";
}
