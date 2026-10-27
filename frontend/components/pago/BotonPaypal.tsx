"use client";

// Botón de PayPal con el JS SDK v6, cargado con <script> (sin dependencia npm).
// Documentación: https://developer.paypal.com/sdk/js/set-up («Include the SDK script»,
// «Authenticate the SDK»: el client ID es público y basta para PayPal Checkout).
// El servidor crea la orden (con el monto de la BD) y la captura; aquí nunca hay montos.
import { useEffect, useRef, useState } from "react";
import type { ResultadoCapturar, ResultadoIniciar } from "@lauburu/backend/pagos";
import type { ClientePaypal } from "@lauburu/backend/paypal";
import { formatoPrecio } from "@/lib/formato";

type SesionPaypal = {
  start: (
    opciones: { presentationMode: "auto" },
    orden: Promise<{ orderId: string }>,
  ) => Promise<void>;
};

type SdkPaypal = {
  createInstance: (opciones: { clientId: string; components: string[] }) => Promise<{
    findEligibleMethods: (o: { currencyCode: string }) => Promise<{
      isEligible: (metodo: string) => boolean;
    }>;
    createPayPalOneTimePaymentSession: (callbacks: {
      onApprove: (data: { orderId: string }) => Promise<void>;
      onCancel: () => void;
      onError: (error: Error) => void;
    }) => SesionPaypal;
  }>;
};

declare global {
  interface Window {
    paypal?: SdkPaypal;
  }
}

declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "paypal-button": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        type?: string;
      };
    }
  }
}

let cargaSdk: Promise<SdkPaypal> | null = null;

function cargarSdk(entorno: "sandbox" | "live") {
  cargaSdk ??= new Promise<SdkPaypal>((resolve, reject) => {
    const script = document.createElement("script");
    script.src =
      entorno === "live"
        ? "https://www.paypal.com/web-sdk/v6/core"
        : "https://www.sandbox.paypal.com/web-sdk/v6/core";
    script.async = true;
    script.onload = () => (window.paypal ? resolve(window.paypal) : reject(new Error("sin SDK")));
    script.onerror = () => {
      cargaSdk = null;
      reject(new Error("no cargó el SDK"));
    };
    document.head.appendChild(script);
  });
  return cargaSdk;
}

const MENSAJES_INICIO: Record<Exclude<ResultadoIniciar, { ok: true }>["error"], string> = {
  no_disponible: "Se acabó el tiempo para pagar. Vuelve a elegir y apartamos de nuevo.",
  sin_trm:
    "Hoy no podemos calcular el valor en dólares. Escríbenos por WhatsApp y te ayudamos a pagar.",
  sin_configuracion: "El pago con PayPal no está disponible en este momento.",
  datos_invalidos: "No pudimos iniciar el pago. Recarga la página e intenta de nuevo.",
  error_pasarela: "No pudimos conectar con PayPal. Intenta de nuevo en un momento.",
};

const MENSAJES_CAPTURA: Record<Exclude<ResultadoCapturar, { ok: true }>["error"], string> = {
  rechazado: "PayPal rechazó el pago. Puedes intentarlo con otra tarjeta o cuenta.",
  no_disponible: "Se acabó el tiempo para pagar y no hicimos ningún cobro. Vuelve a elegir.",
  datos_invalidos: "No pudimos completar el pago. Recarga la página e intenta de nuevo.",
  error_pasarela:
    "No pudimos confirmar el cobro con PayPal. Si ves el cargo en tu cuenta, escríbenos por WhatsApp con tu código.",
};

/** Medio de pago disponible (por ahora solo PayPal) con el cobro aproximado en USD. */
export function MedioPaypal({ totalCop, trm }: { totalCop: number; trm: number | null }) {
  return (
    <div className="mt-6 rounded-card border border-verde bg-blanco p-4">
      <h3 className="font-serif text-h3 text-verde">Pagas con PayPal</h3>
      <p className="mt-1 text-small">
        Pago internacional en dólares estadounidenses, con tu cuenta PayPal o con tarjeta.
      </p>
      {trm && (
        <p className="mt-1 text-small">
          Cobro aproximado: {formatoPrecio(totalCop, "USD", trm)}. El valor final se calcula con
          la TRM del día del pago.
        </p>
      )}
    </div>
  );
}

export function BotonPaypal({
  paypal: { clientId, entorno },
  iniciar,
  capturar,
  alAprobar,
  alError,
}: {
  paypal: ClientePaypal;
  iniciar: () => Promise<ResultadoIniciar>;
  capturar: (idOrden: string) => Promise<ResultadoCapturar>;
  /** El pago se capturó: ir a la página que consulta el estado (el webhook confirma). */
  alAprobar: () => void;
  alError: (mensaje: string | null) => void;
}) {
  const [estado, setEstado] = useState<"cargando" | "listo" | "procesando" | "no_disponible">(
    "cargando",
  );
  const sesion = useRef<SesionPaypal | null>(null);
  /** Motivo por el que el servidor no creó la orden (tiene prioridad sobre el error genérico). */
  const errorInicio = useRef<string | null>(null);
  // Las funciones del padre cambian en cada render; la sesión de PayPal se crea una sola vez.
  const callbacks = useRef({ capturar, alAprobar, alError });
  callbacks.current = { capturar, alAprobar, alError };

  useEffect(() => {
    let vigente = true;
    (async () => {
      const sdk = await cargarSdk(entorno);
      const instancia = await sdk.createInstance({ clientId, components: ["paypal-payments"] });
      const metodos = await instancia.findEligibleMethods({ currencyCode: "USD" });
      if (!vigente) return;
      if (!metodos.isEligible("paypal")) {
        setEstado("no_disponible");
        return;
      }
      sesion.current = instancia.createPayPalOneTimePaymentSession({
        async onApprove({ orderId }) {
          setEstado("procesando");
          const r = await callbacks.current.capturar(orderId);
          if (r.ok) return callbacks.current.alAprobar();
          setEstado("listo");
          callbacks.current.alError(MENSAJES_CAPTURA[r.error]);
        },
        onCancel() {
          setEstado("listo");
          callbacks.current.alError(
            "Cancelaste el pago en PayPal. Seguimos apartando tu compra mientras corre el tiempo.",
          );
        },
        onError() {
          setEstado("listo");
          callbacks.current.alError(
            errorInicio.current ??
              "PayPal no pudo procesar el pago. Intenta de nuevo o usa otra tarjeta o cuenta.",
          );
        },
      });
      setEstado("listo");
    })().catch(() => vigente && setEstado("no_disponible"));
    return () => {
      vigente = false;
    };
  }, [clientId, entorno]);

  async function pagar() {
    if (!sesion.current || estado !== "listo") return;
    alError(null);
    errorInicio.current = null;
    // Sin await: PayPal pide iniciar la sesión en el mismo clic (activación del usuario).
    const orden = iniciar().then((r) => {
      if (r.ok) return { orderId: r.idOrden };
      errorInicio.current = MENSAJES_INICIO[r.error];
      throw new Error(r.error);
    });
    try {
      await sesion.current.start({ presentationMode: "auto" }, orden);
    } catch {
      alError(errorInicio.current ?? "No pudimos abrir PayPal. Intenta de nuevo en un momento.");
    }
  }

  if (estado === "no_disponible") {
    return (
      <p className="text-small">
        PayPal no está disponible en este momento. Escríbenos por WhatsApp y te ayudamos a pagar.
      </p>
    );
  }

  return (
    <div aria-busy={estado !== "listo"} className="w-full sm:w-72">
      {estado === "procesando" && (
        <p role="status" className="mb-2 text-small font-medium text-verde">
          Procesando tu pago…
        </p>
      )}
      {estado === "cargando" ? (
        <p role="status" className="text-small">
          Cargando PayPal…
        </p>
      ) : (
        <paypal-button
          type="pay"
          onClick={pagar}
          className={estado === "procesando" ? "pointer-events-none opacity-60" : undefined}
        />
      )}
    </div>
  );
}
