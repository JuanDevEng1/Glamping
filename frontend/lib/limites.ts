// Límites de peticiones por IP para las acciones y endpoints públicos (solo servidor).
// El conteo vive en Postgres (backend/src/db.ts → permitirPeticion).
import { headers } from "next/headers";
import { permitirPeticion } from "@lauburu/backend/db";

/** [máximo, segundos] por tipo de petición. */
const LIMITES = {
  /** Cotizar, calendario, carrito: se llaman al mover fechas, huéspedes o cantidades. */
  consulta: [60, 60],
  /** Crear una reserva o un pedido (apartan fechas o cupos). */
  crear: [10, 600],
  /** Vincular una reserva con código y correo: frena el intento de adivinar códigos. */
  vincular: [10, 900],
  /** Iniciar o capturar un pago con PayPal. */
  pago: [20, 600],
  documento: [5, 3600],
} as const;

/** IP del visitante: Netlify la pone en x-nf-client-connection-ip; en local, x-forwarded-for. */
async function ipCliente() {
  const h = await headers();
  return (
    h.get("x-nf-client-connection-ip") ??
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "desconocida"
  );
}

/** Cuenta la petición y dice si `accion` sigue dentro de su límite para esta IP. */
export async function dentroDelLimite(accion: string, tipo: keyof typeof LIMITES) {
  const [max, segundos] = LIMITES[tipo];
  return permitirPeticion(`${accion}:${await ipCliente()}`, max, segundos);
}
