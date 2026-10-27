"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, Copy, IdCard, Info, Upload } from "lucide-react";
import type { ResultadoDocumento } from "@lauburu/backend/reservas";
import { subirDocumento } from "@/app/reservas/acciones";
import { Tarjeta, claseBoton } from "@/components/ui";
import { Campo } from "./FlujoReserva";

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

// Mismo límite que MAX_BYTES_DOCUMENTO en el backend, que es quien valida de verdad.
const MAX_BYTES_DOCUMENTO = 4 * 1024 * 1024;

const ERRORES_DOCUMENTO: Record<Exclude<ResultadoDocumento, { ok: true }>["error"], string> = {
  datos_invalidos: "Elige el archivo de tu documento.",
  archivo_invalido: "Solo podemos recibir una foto (JPG o PNG) o un PDF.",
  archivo_grande:
    "El archivo pesa más de 4 MB. Prueba con una foto más liviana o un PDF más pequeño.",
  no_disponible:
    "No pudimos asociar el documento a esta reserva. Escríbenos por WhatsApp y te ayudamos.",
  ya_recibido: "",
  error_correo: "No pudimos enviar tu documento. Intenta de nuevo en unos minutos.",
  sin_configuracion: "No pudimos enviar tu documento. Intenta de nuevo en unos minutos.",
  demasiadas_peticiones: "Hiciste varios intentos seguidos. Espera un rato y vuelve a intentarlo.",
};

/** Paso posterior al pago: el titular sube su documento y se envía al admin por correo. */
export function SubirDocumento({ codigo, recibido }: { codigo: string; recibido: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [enviando, iniciar] = useTransition();

  if (recibido) {
    return (
      <Tarjeta borde="miel">
        <h2 className="flex items-center gap-2 font-serif text-h3 text-verde">
          <CircleCheck size={24} strokeWidth={1.5} aria-hidden /> Recibimos tu documento
        </h2>
        <p className="mt-2 max-w-[65ch]">
          ¡Gracias! Cuando llegues, ten a mano tu documento original: lo revisaremos un momento para
          confirmar que eres quien hizo la reserva. ¡Te esperamos!
        </p>
      </Tarjeta>
    );
  }

  function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const datos = new FormData(e.currentTarget);
    const archivo = datos.get("documento");
    if (!(archivo instanceof File) || archivo.size === 0) {
      setError(ERRORES_DOCUMENTO.datos_invalidos);
      return;
    }
    if (archivo.size > MAX_BYTES_DOCUMENTO) {
      setError(ERRORES_DOCUMENTO.archivo_grande);
      return;
    }
    setError(undefined);
    iniciar(async () => {
      try {
        const resultado = await subirDocumento(codigo, datos);
        if (resultado.ok || resultado.error === "ya_recibido") router.refresh();
        else setError(ERRORES_DOCUMENTO[resultado.error]);
      } catch {
        setError(ERRORES_DOCUMENTO.error_correo);
      }
    });
  }

  return (
    <Tarjeta>
      <h2 className="flex items-center gap-2 font-serif text-h3 text-verde">
        <IdCard size={24} strokeWidth={1.5} aria-hidden /> Tu documento de identidad
      </h2>
      <p className="mt-2 max-w-[65ch]">
        Para tener todo listo antes de tu llegada, sube una foto o un PDF del documento que
        registraste al reservar.
      </p>
      <form onSubmit={enviar} noValidate className="mt-4 flex flex-col gap-4">
        <Campo
          id="campo-documento-archivo"
          etiqueta="Foto o PDF del documento"
          ayuda="JPG, PNG o PDF de hasta 4 MB. Asegúrate de que se lean bien tu nombre y tu número."
          error={error}
        >
          <input
            id="campo-documento-archivo"
            name="documento"
            type="file"
            accept="image/jpeg,image/png,application/pdf"
            onChange={() => setError(undefined)}
            aria-invalid={!!error}
            aria-describedby={
              error ? "campo-documento-archivo-error" : "campo-documento-archivo-ayuda"
            }
            className="w-full rounded-card border border-niebla bg-blanco p-2 text-base text-cafe file:mr-4 file:rounded-full file:border-0 file:bg-verde-tinte file:px-4 file:py-2 file:font-medium file:text-verde focus:border-verde focus:ring-2 focus:ring-verde/20 focus:outline-none"
          />
        </Campo>
        <button
          type="submit"
          disabled={enviando}
          className={`${claseBoton("primario")} w-full sm:w-auto sm:self-start`}
        >
          <Upload size={20} strokeWidth={1.5} aria-hidden />
          <span aria-live="polite">{enviando ? "Enviando…" : "Enviar documento"}</span>
        </button>
      </form>
      <p className="mt-4 flex items-start gap-3 rounded-card bg-verde-tinte p-4 text-small">
        <Info size={20} strokeWidth={1.5} className="shrink-0 text-verde" aria-hidden />
        <span>
          Cuando llegues a Lauburu te pediremos el documento original, solo para confirmar que eres
          la persona que hizo la reserva. Es un momento y nos ayuda a cuidar tu estadía.
        </span>
      </p>
    </Tarjeta>
  );
}
