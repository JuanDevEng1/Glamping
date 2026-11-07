// Cliente HTTP mínimo de la API REST de Openpay Colombia (sin SDK: fetch + Zod), como paypal.ts.
// Documentación oficial consultada el 2026-11-05:
// - API Reference (https://documents.openpay.co/api/index.html):
//   «Autenticación»: llave privada como usuario de HTTP Basic y contraseña vacía; URIs base
//   https://sandbox-api.openpay.co y https://api.openpay.co. La llave pública solo crea tokens.
//   «Cargos › Con id de tarjeta o token»: method card, source_id, amount, currency COP, iva,
//   description, device_session_id (requerido), customer, order_id (único: error 1006).
//   «PSE»: POST /v1/{merchant}/pse → { orderId, redirect_url }.
//   «Obtener un cargo», «Devolver un cargo» (monto ≤ original), «Errores» (error_code).
// - Webhooks (https://docs.openpay.co/en/docs/webhooks.html): "Currently only HTTP Basic
//   authentication is supported"; evento `verification` con `verification_code`; payload
//   { type, event_date, transaction }; reintenta hasta recibir 200.
// Verificado en sandbox el 2026-11-05 (no está en la referencia pública de Colombia):
// - `capture: false` crea una preautorización en estado `in_progress`.
// - POST /charges/{id}/capture { amount } la confirma, también por un monto menor → `completed`.
// - POST /charges/{id}/refund sobre una preautorización la libera → `cancelled`.
// - El dashboard muestra "Confirmar" y "Reembolsar" en una preautorización pendiente.
// - POST /charges con method bank_account responde 1001: PSE va por /pse.
// - Ningún cargo de prueba pidió 3D Secure.
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * Días que el banco mantiene una preautorización de Openpay. TODO(cliente): confirmarlo con
 * Openpay Colombia. 7 es la cifra de la documentación del plugin oficial de Openpay para
 * Magento 2 (ramas de Colombia), no de la API: si no se confirma en 7 días, se libera.
 */
export const DIAS_VIGENCIA_PREAUTORIZACION = 7;

function config() {
  const merchantId = process.env.OPENPAY_MERCHANT_ID;
  const llavePrivada = process.env.OPENPAY_LLAVE_PRIVADA;
  if (!merchantId || !llavePrivada)
    throw new Error("Faltan OPENPAY_MERCHANT_ID o OPENPAY_LLAVE_PRIVADA");
  const base =
    process.env.OPENPAY_ENTORNO === "produccion"
      ? "https://api.openpay.co"
      : "https://sandbox-api.openpay.co";
  return { base: `${base}/v1/${encodeURIComponent(merchantId)}`, llavePrivada };
}

/** Openpay se ofrece solo si las credenciales del servidor y la llave pública están. */
export function openpayConfigurado() {
  return !!(
    process.env.OPENPAY_MERCHANT_ID &&
    process.env.OPENPAY_LLAVE_PRIVADA &&
    process.env.OPENPAY_LLAVE_PUBLICA
  );
}

export type ClienteOpenpay = { merchantId: string; llavePublica: string; sandbox: boolean };

/** Datos públicos para openpay.js (merchant id y llave pública no son secretos), o null. */
export function clienteOpenpay(): ClienteOpenpay | null {
  if (!openpayConfigurado()) return null;
  return {
    merchantId: process.env.OPENPAY_MERCHANT_ID!,
    llavePublica: process.env.OPENPAY_LLAVE_PUBLICA!,
    sandbox: process.env.OPENPAY_ENTORNO !== "produccion",
  };
}

export class ErrorOpenpay extends Error {
  constructor(
    readonly status: number,
    /** `error_code` de Openpay, ej. 3001 (declinada), 3005 (antifraude), 1006 (order_id repetido). */
    readonly codigo: number | null,
  ) {
    super(`Openpay respondió ${status}${codigo ? ` (${codigo})` : ""}`);
  }
}

async function llamar(metodo: "GET" | "POST", ruta: string, cuerpo?: unknown) {
  const { base, llavePrivada } = config();
  const res = await fetch(`${base}${ruta}`, {
    method: metodo,
    headers: {
      Authorization: `Basic ${Buffer.from(`${llavePrivada}:`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(20_000),
  });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = z.object({ error_code: z.number() }).safeParse(json);
    throw new ErrorOpenpay(res.status, error.data?.error_code ?? null);
  }
  return json;
}

// ---------------------------------------------------------------------------
// Cargos
// ---------------------------------------------------------------------------

const esquemaCargo = z
  .object({
    id: z.string(),
    /** in_progress (preautorizado o PSE en curso), completed, cancelled, failed, charge_pending… */
    status: z.string(),
    amount: z.number(),
    currency: z.string(),
    order_id: z.string().nullish(),
    method: z.string().nullish(),
  })
  .loose();

export type CargoOpenpay = z.infer<typeof esquemaCargo>;

export type ClienteCargo = { nombre: string; correo: string; telefono: string };

/** El nombre completo va en `name` y `last_name` como lo pide Openpay. */
function cliente(c: ClienteCargo) {
  const [nombre = c.nombre, ...resto] = c.nombre.trim().split(/\s+/);
  return {
    name: nombre,
    last_name: resto.join(" ") || nombre,
    email: c.correo,
    phone_number: c.telefono,
  };
}

/**
 * Cargo con tarjeta tokenizada en el navegador. Con `capturar: false` solo aparta el dinero
 * (depósito de garantía); el admin lo confirma o lo reembolsa desde el dashboard.
 */
export async function crearCargoTarjeta(datos: {
  token: string;
  deviceSessionId: string;
  montoCop: number;
  descripcion: string;
  ordenId: string;
  cliente: ClienteCargo;
  capturar: boolean;
}) {
  return esquemaCargo.parse(
    await llamar("POST", "/charges", {
      method: "card",
      source_id: datos.token,
      amount: datos.montoCop,
      currency: "COP",
      // TODO(cliente): confirmar con el contador qué IVA aplica (alojamiento y servicios).
      iva: "0",
      description: datos.descripcion,
      order_id: datos.ordenId,
      device_session_id: datos.deviceSessionId,
      customer: cliente(datos.cliente),
      capture: datos.capturar,
    }),
  );
}

/** Cargo PSE: devuelve la URL del checkout de Openpay a la que se envía al huésped. */
export async function crearCargoPse(datos: {
  montoCop: number;
  descripcion: string;
  ordenId: string;
  cliente: ClienteCargo;
  urlRetorno: string;
}) {
  const respuesta = z
    .object({ orderId: z.string(), redirect_url: z.string().url() })
    .parse(
      await llamar("POST", "/pse", {
        country: "COL",
        amount: datos.montoCop,
        currency: "COP",
        iva: "0", // TODO(cliente): ver crearCargoTarjeta.
        description: datos.descripcion,
        order_id: datos.ordenId,
        redirect_url: datos.urlRetorno,
        customer: { ...cliente(datos.cliente), requires_account: false },
      }),
    );
  return { urlBanco: respuesta.redirect_url };
}

export async function obtenerCargo(id: string) {
  return esquemaCargo.parse(await llamar("GET", `/charges/${encodeURIComponent(id)}`));
}

/**
 * Libera una preautorización sin cobrarla («Devolver un cargo» sobre un cargo con capture=false;
 * verificado en sandbox: queda `cancelled`). Se usa con el depósito de una reserva que no se pagó.
 */
export async function liberarPreautorizacion(id: string) {
  return esquemaCargo.parse(
    await llamar("POST", `/charges/${encodeURIComponent(id)}/refund`, {
      description: "Depósito de garantía liberado: la reserva no se completó",
    }),
  );
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export const esquemaEventoOpenpay = z
  .object({
    type: z.string(),
    event_date: z.string().optional(),
    verification_code: z.string().optional(),
    transaction: z
      .object({ id: z.string(), status: z.string().optional(), order_id: z.string().nullish() })
      .loose()
      .optional(),
  })
  .loose();

export type EventoOpenpay = z.infer<typeof esquemaEventoOpenpay>;

const huella = (texto: string) => createHash("sha256").update(texto).digest();

/**
 * Openpay solo autentica webhooks con HTTP Basic: compara usuario y clave con los configurados
 * al registrar el webhook (OPENPAY_WEBHOOK_USUARIO / OPENPAY_WEBHOOK_CLAVE), en tiempo constante.
 */
export function webhookAutenticado(cabeceras: Headers) {
  const usuario = process.env.OPENPAY_WEBHOOK_USUARIO;
  const clave = process.env.OPENPAY_WEBHOOK_CLAVE;
  if (!usuario || !clave) throw new Error("Faltan OPENPAY_WEBHOOK_USUARIO u OPENPAY_WEBHOOK_CLAVE");
  const cabecera = cabeceras.get("authorization") ?? "";
  if (!cabecera.startsWith("Basic ")) return false;
  const recibido = Buffer.from(cabecera.slice(6), "base64").toString("utf8");
  return timingSafeEqual(huella(recibido), huella(`${usuario}:${clave}`));
}
