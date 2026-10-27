import { NextResponse, type NextRequest } from "next/server";
import { mesPermitido, obtenerCalendario } from "@lauburu/backend/reservas";
import { dentroDelLimite } from "@/lib/limites";

// Precios y disponibilidad por mes. Siempre fresco: la disponibilidad cambia con cada reserva.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await dentroDelLimite("calendario", "consulta"))) {
    return NextResponse.json(
      { error: "Demasiadas peticiones" },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }
  const mes = req.nextUrl.searchParams.get("mes") ?? "";
  if (!mesPermitido(mes)) {
    return NextResponse.json({ error: "Mes no permitido" }, { status: 400 });
  }
  const dias = await obtenerCalendario(mes);
  if (!dias) {
    return NextResponse.json({ error: "Reservas no disponibles" }, { status: 503 });
  }
  return NextResponse.json({ mes, dias }, { headers: { "Cache-Control": "no-store" } });
}
