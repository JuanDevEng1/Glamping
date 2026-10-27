import { NextResponse, type NextRequest } from "next/server";
import { procesarWebhookPaypal } from "@lauburu/backend/pagos";

// Webhook de PayPal: único punto que confirma pagos. La firma se verifica con el cuerpo
// crudo; cualquier respuesta distinta de 2xx hace que PayPal reintente (hasta 3 días).
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const status = await procesarWebhookPaypal(req.headers, await req.text());
  return NextResponse.json({ ok: status === 200 }, { status });
}
