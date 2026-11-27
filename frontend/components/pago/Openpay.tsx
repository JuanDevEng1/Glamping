"use client";

// Pago con Openpay (pesos colombianos): tarjeta tokenizada en el navegador y PSE.
// openpay.js y openpay-data.js (versión Colombia) se cargan con <script>, sin dependencia npm. Documentación:
// https://docs.openpay.co/docs/openpayjs.html («Creación tokens sin formulario») y
// https://docs.openpay.co/docs/fraud-tool.html («Implementación con JavaScript»).
// Los datos de la tarjeta van directo a Openpay: los campos no tienen `name` y nunca se envían
// al servidor; este solo recibe el token y el device_session_id. Aquí nunca hay montos.
import { useEffect, useId, useRef, useState } from "react";
import { CreditCard, Landmark } from "lucide-react";
import type { ClienteOpenpay } from "@lauburu/backend/openpay";
import { claseBoton } from "@/components/ui";
import { Campo, claseCampo } from "@/components/reserva/FlujoReserva";

type RespuestaToken = { data: { id: string } };
type ErrorToken = { data?: { error_code?: number; description?: string } };

/**
 * Errores al crear el token, verificados en sandbox el 2026-11-05: 2004 (dígito verificador),
 * 2005 (vencida), 1001 (formato, p. ej. código de seguridad de otra longitud).
 */
function mensajeToken(codigo: number | undefined) {
  switch (codigo) {
    case 2004:
      return "El número de la tarjeta no es válido. Revísalo dígito por dígito.";
    case 2005:
      return "La tarjeta está vencida. Revisa el mes y el año, o usa otra tarjeta.";
    case 1001:
      return "Revisa los datos de la tarjeta: el código de seguridad tiene 3 dígitos (4 en American Express) y la fecha va como MM y AA.";
    default:
      return `No pudimos validar la tarjeta${codigo ? ` (código ${codigo})` : ""}. Revisa los datos o prueba con otra tarjeta.`;
  }
}

type SdkOpenpay = {
  setId: (id: string) => void;
  setApiKey: (llave: string) => void;
  setSandboxMode: (sandbox: boolean) => void;
  token: {
    create: (
      datos: Record<string, string>,
      ok: (r: RespuestaToken) => void,
      error: (e: ErrorToken) => void,
    ) => void;
  };
  deviceData: { setup: (formId: string, campo: string) => string };
};

declare global {
  interface Window {
    OpenPay?: SdkOpenpay;
  }
}

function cargarScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const script = document.createElement("script");
    script.src = src;
    script.async = false; // openpay-data.js depende de openpay.js.
    script.onload = () => resolve();
    script.onerror = () => {
      script.remove();
      reject(new Error(`no cargó ${src}`));
    };
    document.head.appendChild(script);
  });
}

let carga: Promise<SdkOpenpay> | null = null;

function cargarOpenpay() {
  carga ??= (async () => {
    // Versión de COLOMBIA: llama a sandbox-api.openpay.co / api.openpay.co. La de
    // openpay.s3.amazonaws.com (la que muestra la documentación) llama a la API de México y
    // responde 1002 con un comercio colombiano. Verificado el 2026-11-05: estos archivos son
    // la rama `colombia` de https://github.com/open-pay/openpay-js publicada en un dominio de Openpay.
    await cargarScript("https://resources.openpay.co/openpay.v1.min.js");
    await cargarScript("https://resources.openpay.co/openpay-data.v1.min.js");
    if (!window.OpenPay) throw new Error("sin openpay.js");
    return window.OpenPay;
  })().catch((error: unknown) => {
    carga = null;
    throw error;
  });
  return carga;
}

/** Resultado de las acciones del servidor (pago, depósito o PSE). */
export type ResultadoOpenpayAccion = { ok: true } | { ok: false; error: string };

const MENSAJES: Record<string, string> = {
  rechazado:
    "Tu banco rechazó la tarjeta. Revisa que tenga cupo o saldo disponible, o prueba con otra tarjeta.",
  requiere_autorizacion_banco:
    "Tu banco pide que autorices este pago. Comunícate con tu banco o intenta con otra tarjeta.",
  no_disponible: "Se acabó el tiempo para pagar y no hicimos ningún cobro. Vuelve a elegir.",
  sin_configuracion: "El pago con Openpay no está disponible en este momento.",
  datos_invalidos: "No pudimos procesar el pago. Recarga la página e intenta de nuevo.",
  error_pasarela:
    "No pudimos conectar con Openpay. Si ves el cargo en tu cuenta, escríbenos por WhatsApp con tu código.",
  demasiadas_peticiones:
    "Hiciste muchos intentos seguidos. Espera unos minutos y vuelve a intentarlo.",
  falta_deposito: "Primero autoriza el depósito de garantía con tu tarjeta.",
  ya_existe: "Tu depósito ya está autorizado. Continúa con el pago.",
  sin_deposito: "Esta reserva no necesita depósito de garantía.",
};

const mensajeDe = (error: string) => MENSAJES[error] ?? MENSAJES.datos_invalidos!;

/** Openpay no pudo tokenizar la tarjeta (datos inválidos o vencida). */
class ErrorTokenTarjeta extends Error {
  constructor(readonly codigo: number | undefined) {
    super("token");
  }
}

type Campos = { titular: string; numero: string; mes: string; anio: string; cvv: string };
const VACIO: Campos = { titular: "", numero: "", mes: "", anio: "", cvv: "" };

function validar(c: Campos): Partial<Record<keyof Campos, string>> {
  const errores: Partial<Record<keyof Campos, string>> = {};
  if (c.titular.trim().length < 3) errores.titular = "Escribe el nombre como aparece en la tarjeta.";
  if (!/^\d{13,19}$/.test(c.numero.replace(/\s/g, "")))
    errores.numero = "Revisa el número de la tarjeta.";
  const mes = Number(c.mes);
  if (!/^\d{1,2}$/.test(c.mes) || mes < 1 || mes > 12) errores.mes = "Mes de 01 a 12.";
  if (!/^\d{2}$/.test(c.anio)) errores.anio = "Dos dígitos, ej. 29.";
  if (!/^\d{3,4}$/.test(c.cvv)) errores.cvv = "3 o 4 dígitos.";
  return errores;
}

/**
 * Formulario de tarjeta. `enviar` recibe `crearToken` y el id antifraude y llama a las acciones
 * del servidor. Cada token sirve para un solo cargo: el depósito y el pago piden uno cada uno,
 * con la misma tarjeta y en el mismo clic.
 */
export function FormularioTarjeta({
  openpay,
  textoBoton,
  textoProcesando = "Procesando tu pago…",
  enviar,
  alExito,
  alError,
}: {
  openpay: ClienteOpenpay;
  textoBoton: string;
  textoProcesando?: string;
  enviar: (
    crearToken: () => Promise<string>,
    deviceSessionId: string,
  ) => Promise<ResultadoOpenpayAccion>;
  alExito: () => void;
  alError: (mensaje: string | null) => void;
}) {
  const id = useId();
  const formId = `openpay-${id.replace(/:/g, "")}`;
  const [estado, setEstado] = useState<"cargando" | "listo" | "procesando" | "no_disponible">(
    "cargando",
  );
  const [campos, setCampos] = useState<Campos>(VACIO);
  const [errores, setErrores] = useState<Partial<Record<keyof Campos, string>>>({});
  const sdk = useRef<SdkOpenpay | null>(null);
  const sesion = useRef<string>("");

  useEffect(() => {
    let vigente = true;
    cargarOpenpay()
      .then((openpayJs) => {
        if (!vigente) return;
        openpayJs.setId(openpay.merchantId);
        openpayJs.setApiKey(openpay.llavePublica);
        openpayJs.setSandboxMode(openpay.sandbox);
        sesion.current = openpayJs.deviceData.setup(formId, "device_session_id");
        sdk.current = openpayJs;
        setEstado("listo");
      })
      .catch(() => vigente && setEstado("no_disponible"));
    return () => {
      vigente = false;
    };
  }, [formId, openpay.merchantId, openpay.llavePublica, openpay.sandbox]);

  const cambiar = (campo: keyof Campos) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setCampos((c) => ({ ...c, [campo]: e.target.value }));
    setErrores((er) => ({ ...er, [campo]: undefined }));
  };

  async function pagar(e: React.FormEvent) {
    e.preventDefault();
    if (!sdk.current || estado !== "listo") return;
    alError(null);
    const encontrados = validar(campos);
    setErrores(encontrados);
    if (Object.keys(encontrados).length > 0) return;

    setEstado("procesando");
    const datos = {
      holder_name: campos.titular.trim(),
      card_number: campos.numero.replace(/\s/g, ""),
      expiration_month: campos.mes.padStart(2, "0"),
      expiration_year: campos.anio,
      cvv2: campos.cvv,
    };
    const crearToken = () =>
      new Promise<string>((resolve, reject) =>
        sdk.current!.token.create(
          datos,
          (r) => resolve(r.data.id),
          (e) => reject(new ErrorTokenTarjeta(e.data?.error_code)),
        ),
      );
    try {
      const r = await enviar(crearToken, sesion.current);
      if (r.ok) return alExito();
      alError(mensajeDe(r.error));
    } catch (error) {
      if (error instanceof ErrorTokenTarjeta) {
        // Solo el código de Openpay: nunca datos de la tarjeta.
        console.warn("Openpay: no se creó el token de la tarjeta, código", error.codigo);
        alError(mensajeToken(error.codigo));
      } else alError(MENSAJES.error_pasarela!);
    } finally {
      // El código de seguridad no se guarda en pantalla después de usarlo.
      setCampos((c) => ({ ...c, cvv: "" }));
      setEstado((s) => (s === "procesando" ? "listo" : s));
    }
  }

  if (estado === "no_disponible") {
    return (
      <p className="text-small">
        El pago con tarjeta no está disponible en este momento. Prueba con otro medio de pago.
      </p>
    );
  }

  const campo = (
    clave: keyof Campos,
    etiqueta: string,
    props: React.InputHTMLAttributes<HTMLInputElement>,
    className = "",
  ) => (
    <Campo id={`${formId}-${clave}`} etiqueta={etiqueta} error={errores[clave]} className={className}>
      {/* Sin `name`: los datos de la tarjeta nunca se envían al servidor. */}
      <input
        id={`${formId}-${clave}`}
        value={campos[clave]}
        onChange={cambiar(clave)}
        aria-invalid={!!errores[clave]}
        aria-describedby={errores[clave] ? `${formId}-${clave}-error` : undefined}
        disabled={estado !== "listo"}
        className={claseCampo(!!errores[clave])}
        {...props}
      />
    </Campo>
  );

  return (
    <form id={formId} onSubmit={pagar} noValidate className="flex flex-col gap-4" aria-busy={estado !== "listo"}>
      {campo("titular", "Nombre en la tarjeta", { autoComplete: "cc-name" })}
      {campo("numero", "Número de la tarjeta", {
        autoComplete: "cc-number",
        inputMode: "numeric",
        maxLength: 23,
      })}
      <div className="grid grid-cols-3 gap-4">
        {campo("mes", "Mes", { autoComplete: "cc-exp-month", inputMode: "numeric", maxLength: 2, placeholder: "MM" })}
        {campo("anio", "Año", { autoComplete: "cc-exp-year", inputMode: "numeric", maxLength: 2, placeholder: "AA" })}
        {campo("cvv", "Código", { autoComplete: "cc-csc", inputMode: "numeric", maxLength: 4, type: "password" })}
      </div>
      <button
        type="submit"
        disabled={estado !== "listo"}
        className={`${claseBoton("primario")} w-full sm:w-auto sm:self-start`}
      >
        <CreditCard size={20} strokeWidth={1.5} aria-hidden />
        <span aria-live="polite">
          {estado === "cargando"
            ? "Cargando…"
            : estado === "procesando"
              ? textoProcesando
              : textoBoton}
        </span>
      </button>
      <p className="text-xs">Pago seguro procesado por Openpay. No guardamos los datos de tu tarjeta.</p>
    </form>
  );
}

/** PSE: el servidor crea el cargo y aquí solo se redirige al banco. */
export function BotonPse({
  iniciar,
  alError,
}: {
  iniciar: () => Promise<{ ok: true; urlBanco: string } | { ok: false; error: string }>;
  alError: (mensaje: string | null) => void;
}) {
  const [cargando, setCargando] = useState(false);

  async function irAlBanco() {
    alError(null);
    setCargando(true);
    try {
      const r = await iniciar();
      if (r.ok) {
        window.location.assign(r.urlBanco);
        return;
      }
      alError(mensajeDe(r.error));
    } catch {
      alError(MENSAJES.error_pasarela!);
    }
    setCargando(false);
  }

  return (
    <button
      type="button"
      onClick={irAlBanco}
      disabled={cargando}
      className={`${claseBoton("secundario")} w-full sm:w-auto`}
    >
      <Landmark size={20} strokeWidth={1.5} aria-hidden />
      <span aria-live="polite">{cargando ? "Conectando con tu banco…" : "Pagar con PSE"}</span>
    </button>
  );
}
