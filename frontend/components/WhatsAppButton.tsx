import { MessageCircle } from "lucide-react";
import { enlaceWhatsApp } from "@/lib/sitio";

// Lucide no incluye logos de marcas; MessageCircle es el ícono más cercano.
export function WhatsAppButton() {
  return (
    <a
      href={enlaceWhatsApp()}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Escribir por WhatsApp"
      className="on-dark fixed right-4 bottom-4 z-40 inline-flex size-14 items-center justify-center rounded-full bg-verde text-crema shadow-soft transition-colors duration-200 hover:bg-verde-hoja"
    >
      <MessageCircle size={24} strokeWidth={1.5} />
    </a>
  );
}
