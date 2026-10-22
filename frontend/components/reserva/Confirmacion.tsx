"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy } from "lucide-react";
import { claseBoton } from "@/components/ui";

export function CopiarCodigo({ codigo }: { codigo: string }) {
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(codigo);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Sin permiso de portapapeles: el código sigue visible para copiarlo a mano.
    }
  }

  return (
    <button type="button" onClick={copiar} className={claseBoton("secundario", "compacto")}>
      <Copy size={20} strokeWidth={1.5} aria-hidden />
      <span aria-live="polite">{copiado ? "Copiado" : "Copiar código"}</span>
    </button>
  );
}

/** Vuelve a pedir la página cada 5 s mientras el pago está pendiente (el webhook confirma). */
export function RefrescoAutomatico({ hasta }: { hasta: string }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (Date.now() > new Date(hasta).getTime() + 10_000) clearInterval(id);
      router.refresh();
    }, 5000);
    return () => clearInterval(id);
  }, [hasta, router]);
  return null;
}
