import { NextResponse, type NextRequest } from "next/server";
import { procesarWebhookOpenpay } from "@lauburu/backend/pagos";

// Webhook de Openpay: junto con el de PayPal, único punto que confirma pagos. Openpay solo
// autentica con HTTP Basic; el backend además vuelve a consultar el cargo en la API.
// Cualquier respuesta distinta de 2xx hace que Openpay reintente.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const status = await procesarWebhookOpenpay(req.headers, await req.text());
  return NextResponse.json({ ok: status === 200 }, { status });
}
