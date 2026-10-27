// Cliente mínimo de la API REST de Resend (sin SDK: fetch + Zod), como paypal.ts.
// Documentación oficial consultada el 2026-10-26:
// - Enviar correo («Body Parameters», «attachments»):
//   https://resend.com/docs/api-reference/emails/send-email
// - Autenticación y cabecera obligatoria («Authentication», «User-Agent»):
//   https://resend.com/docs/api-reference/introduction
// - Adjuntos («Attachment Limitations»: máximo 40 MB por correo tras Base64):
//   https://resend.com/docs/dashboard/emails/attachments
import { z } from "zod";

export type Adjunto = { nombre: string; contenido: Uint8Array };

export function correoConfigurado() {
  return !!(process.env.RESEND_API_KEY && process.env.CORREO_REMITENTE);
}

/** Correos del administrador (CORREO_ADMIN, separados por comas). */
export function correosAdmin() {
  return (process.env.CORREO_ADMIN ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
}

/** Envía un correo de texto. Devuelve el id de Resend; lanza si Resend no lo acepta. */
export async function enviarCorreo(datos: {
  para: string[];
  asunto: string;
  texto: string;
  adjuntos?: Adjunto[];
}) {
  const clave = process.env.RESEND_API_KEY;
  const remitente = process.env.CORREO_REMITENTE;
  if (!clave || !remitente) throw new Error("Faltan RESEND_API_KEY o CORREO_REMITENTE");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${clave}`,
      "Content-Type": "application/json",
      "User-Agent": "lauburu-glamping/1.0",
    },
    body: JSON.stringify({
      from: remitente,
      to: datos.para,
      subject: datos.asunto,
      text: datos.texto,
      attachments: datos.adjuntos?.map((a) => ({
        filename: a.nombre,
        content: Buffer.from(a.contenido).toString("base64"),
      })),
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Resend respondió ${res.status}`);
  return z.object({ id: z.string() }).parse(await res.json()).id;
}
