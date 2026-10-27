"use client";

// Flujo de reserva (wireframes 1–4): Fechas → Huéspedes → Datos → Pago.
// El paso 5 (Confirmación) es /reservas/confirmacion/[codigo] y reutiliza PasosReserva.
// Todo precio sale del servidor (acciones.ts → backend/src/precios.ts).
import { useEffect, useRef, useState, useTransition } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  Clock,
  Minus,
  PawPrint,
  Plus,
} from "lucide-react";
import type { Trm } from "@lauburu/backend/moneda";
import type { ClientePaypal } from "@lauburu/backend/paypal";
import {
  SIN_ADICIONALES,
  textoPersonas,
  totalAdicionales,
  type Adicionales,
  type Cotizacion,
  type TipoNoche,
} from "@lauburu/backend/precios";
import type { ResultadoCotizacion, ResultadoCrear, TipoDocumento } from "@lauburu/backend/reservas";
import { useRouter } from "next/navigation";
import {
  capturarPagoReserva,
  cotizar,
  crearReserva,
  iniciarPagoReserva,
  liberarReserva,
} from "@/app/reservas/acciones";
import { Container } from "@/components/Container";
import { NotaMoneda, Precio } from "@/components/Moneda";
import { BotonPaypal, MedioPaypal } from "@/components/pago/BotonPaypal";
import { FotoPendiente, claseBoton } from "@/components/ui";
import { formatoFechaCorta, formatoHora } from "@/lib/formato";
import { enlaceWhatsApp } from "@/lib/sitio";
import { Calendario } from "./Calendario";

// ---------------------------------------------------------------------------
// Tipos y textos
// ---------------------------------------------------------------------------

export type ConfigFlujo = {
  maxHuespedes: number;
  huespedesIncluidos: number;
  maxAdicionales: number;
  precioAdicionalAdulto: number;
  precioAdicionalNino: number;
  horaCheckin: string;
  horaCheckout: string;
  minutosHold: number;
};

const PASOS = ["Fechas", "Huéspedes", "Datos", "Pago", "Confirmación"] as const;

const TIPOS_NOCHE: Record<TipoNoche, string> = {
  base: "Entre semana",
  alta: "Fin de semana",
  puente: "Puente festivo",
  festivo: "Festivo",
  temporada: "Temporada alta",
  ajuste: "Fecha especial",
};

type Datos = {
  nombre: string;
  tipoDocumento: string;
  documento: string;
  correo: string;
  telefono: string;
  pais: string;
  ciudad: string;
  comentarios: string;
  aceptaTerminos: boolean;
  aceptaMarketing: boolean;
};

const datosIniciales: Datos = {
  nombre: "",
  tipoDocumento: "",
  documento: "",
  correo: "",
  telefono: "",
  pais: "Colombia",
  ciudad: "",
  comentarios: "",
  aceptaTerminos: false,
  aceptaMarketing: false,
};

type Errores = Record<string, string[] | undefined>;

function mensajeError(r: Exclude<ResultadoCotizacion | ResultadoCrear, { ok: true }>, max: number) {
  switch (r.error) {
    case "minimo_noches":
      return `Para estas fechas la estadía mínima es de ${r.minimo} noches.`;
    case "no_disponible":
      return "Esas fechas ya no están disponibles. Elige otras, por favor.";
    case "huespedes_invalidos":
      return `Pueden alojarse de 1 a ${max} personas.`;
    case "adicionales_invalidos":
      return "Revisa los acompañantes adicionales: superan los lugares disponibles.";
    case "sin_configuracion":
      return "Las reservas en línea aún no están habilitadas. Escríbenos por WhatsApp y te ayudamos.";
    case "datos_invalidos":
      return "Revisa los campos marcados.";
    default:
      return "Revisa las fechas elegidas.";
  }
}

// ---------------------------------------------------------------------------
// Stepper (también lo usa la página de confirmación)
// ---------------------------------------------------------------------------

export function PasosReserva({ actual, onIr }: { actual: number; onIr?: (paso: number) => void }) {
  return (
    <nav aria-label="Pasos de la reserva">
      <ol className="flex items-center gap-2 sm:gap-4">
        {PASOS.map((nombre, i) => {
          const paso = i + 1;
          const hecho = paso < actual;
          const activo = paso === actual;
          const circulo = `inline-flex size-8 shrink-0 items-center justify-center rounded-full text-small font-medium ${
            activo
              ? "bg-verde text-crema"
              : hecho
                ? "bg-verde-tinte text-verde"
                : "border border-niebla text-cafe"
          }`;
          const contenido = (
            <>
              <span className={circulo} aria-hidden>
                {hecho ? <Check size={16} strokeWidth={1.5} /> : paso}
              </span>
              <span
                className={`text-small ${activo ? "font-medium text-verde" : "hidden md:inline"}`}
              >
                {nombre}
              </span>
              <span className="sr-only">
                {hecho ? " (completado)" : activo ? " (paso actual)" : ""}
              </span>
            </>
          );
          return (
            <li key={nombre} className="flex items-center gap-2 sm:gap-4">
              {hecho && onIr ? (
                <button
                  type="button"
                  onClick={() => onIr(paso)}
                  className="flex min-h-11 items-center gap-2 underline-offset-4 hover:underline"
                >
                  {contenido}
                </button>
              ) : (
                <span
                  className="flex min-h-11 items-center gap-2"
                  aria-current={activo ? "step" : undefined}
                >
                  {contenido}
                </span>
              )}
              {paso < PASOS.length && <span className="h-px w-4 bg-niebla sm:w-8" aria-hidden />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Piezas
// ---------------------------------------------------------------------------

export function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="mt-4 flex items-start gap-2 text-small text-terracota-oscuro">
      <CircleAlert size={20} strokeWidth={1.5} className="shrink-0" aria-hidden />
      {children}
    </p>
  );
}

function LineaAdicional({
  texto,
  detalle,
  cop,
  trm,
}: {
  texto: string;
  detalle?: string;
  cop: number;
  trm: number | null;
}) {
  return (
    <li className="flex items-baseline justify-between gap-4 py-2 text-small">
      <span>
        {texto}
        {detalle && <span className="block text-xs text-verde">{detalle}</span>}
      </span>
      <span className="shrink-0 font-medium text-verde">
        {cop === 0 ? "Gratis" : <Precio cop={cop} trm={trm} />}
      </span>
    </li>
  );
}

/** − número + accesible. `etiqueta` nombra lo que se cuenta para los lectores de pantalla. */
function Contador({
  etiqueta,
  valor,
  min,
  max,
  onCambio,
}: {
  etiqueta: string;
  valor: number;
  min: number;
  max: number;
  onCambio: (valor: number) => void;
}) {
  const boton =
    "inline-flex size-11 items-center justify-center rounded-full border-[1.5px] border-verde text-verde transition-colors duration-200 hover:bg-verde hover:text-crema disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-verde";
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => onCambio(valor - 1)}
        disabled={valor <= min}
        aria-label={`Quitar: ${etiqueta}`}
        className={boton}
      >
        <Minus size={20} strokeWidth={1.5} />
      </button>
      <output
        aria-live="polite"
        aria-label={etiqueta}
        className="min-w-8 text-center font-serif text-h3 text-verde"
      >
        {valor}
      </output>
      <button
        type="button"
        onClick={() => onCambio(valor + 1)}
        disabled={valor >= max}
        aria-label={`Agregar: ${etiqueta}`}
        className={boton}
      >
        <Plus size={20} strokeWidth={1.5} />
      </button>
    </div>
  );
}

function Desglose({ cot, trm }: { cot: Cotizacion; trm: number | null }) {
  const n = cot.noches.length;
  return (
    <div>
      <ul className="divide-y divide-niebla">
        {cot.noches.map((noche) => (
          <li
            key={noche.fecha}
            className="flex items-baseline justify-between gap-4 py-2 text-small"
          >
            <span>
              Noche del {formatoFechaCorta(noche.fecha)}
              <span className="block text-xs text-verde">{TIPOS_NOCHE[noche.tipo]}</span>
            </span>
            <span className="shrink-0 font-medium text-verde">
              <Precio cop={noche.precio} trm={trm} />
            </span>
          </li>
        ))}
        {cot.personasExtra > 0 && (
          <li className="flex items-baseline justify-between gap-4 py-2 text-small">
            <span>
              {cot.personasExtra}{" "}
              {cot.personasExtra === 1 ? "persona adicional" : "personas adicionales"} × {n}{" "}
              {n === 1 ? "noche" : "noches"}
            </span>
            <span className="shrink-0 font-medium text-verde">
              <Precio cop={cot.extraPersonas} trm={trm} />
            </span>
          </li>
        )}
        {cot.adicionales.adultos > 0 && (
          <LineaAdicional
            texto={`${cot.adicionales.adultos} ${cot.adicionales.adultos === 1 ? "adulto adicional" : "adultos adicionales"} × ${n} ${n === 1 ? "noche" : "noches"}`}
            detalle="Incluye desayuno"
            cop={cot.adicionales.adultos * cot.precioAdicionalAdulto * n}
            trm={trm}
          />
        )}
        {cot.adicionales.ninos > 0 && (
          <LineaAdicional
            texto={`${cot.adicionales.ninos} ${cot.adicionales.ninos === 1 ? "niño" : "niños"} de 4 a 11 años × ${n} ${n === 1 ? "noche" : "noches"}`}
            cop={cot.adicionales.ninos * cot.precioAdicionalNino * n}
            trm={trm}
          />
        )}
        {cot.adicionales.menores > 0 && (
          <LineaAdicional
            texto={`${cot.adicionales.menores} ${cot.adicionales.menores === 1 ? "menor" : "menores"} de 4 años`}
            cop={0}
            trm={trm}
          />
        )}
      </ul>
      <p className="mt-2 flex items-baseline justify-between gap-4 border-t border-verde pt-3">
        <span className="font-medium text-verde">Total</span>
        <span className="text-h3 font-bold text-verde">
          <Precio cop={cot.total} trm={trm} />
        </span>
      </p>
    </div>
  );
}

function Resumen({
  config,
  llegada,
  salida,
  huespedes,
  adicionales,
  cot,
  trm,
  conDesglose,
  children,
}: {
  config: ConfigFlujo;
  llegada?: string;
  salida?: string;
  huespedes: number;
  adicionales: Adicionales;
  cot: Cotizacion | null;
  trm: Trm | null;
  conDesglose: boolean;
  children?: React.ReactNode;
}) {
  return (
    <aside
      aria-labelledby="resumen-titulo"
      className="rounded-card border border-niebla bg-blanco p-5 md:p-6 lg:sticky lg:top-24"
    >
      <FotoPendiente descripcion="Vista del glamping" className="aspect-[3/2]" />
      <h2 id="resumen-titulo" className="mt-4 font-serif text-h3 text-verde">
        Resumen de tu reserva
      </h2>
      <dl className="mt-4 grid grid-cols-2 gap-4 text-small">
        <div>
          <dt className="font-medium text-verde">Llegada (check-in)</dt>
          <dd>{llegada ? formatoFechaCorta(llegada) : "Elige una fecha"}</dd>
          <dd className="text-xs">Desde las {formatoHora(config.horaCheckin)}</dd>
        </div>
        <div>
          <dt className="font-medium text-verde">Salida (check-out)</dt>
          <dd>{salida ? formatoFechaCorta(salida) : "Elige una fecha"}</dd>
          <dd className="text-xs">Hasta las {formatoHora(config.horaCheckout)}</dd>
        </div>
        <div>
          <dt className="font-medium text-verde">Noches</dt>
          <dd>{cot ? cot.noches.length : "—"}</dd>
        </div>
        <div>
          <dt className="font-medium text-verde">Huéspedes</dt>
          <dd>{textoPersonas(huespedes, adicionales)}</dd>
        </div>
      </dl>

      {cot && (
        <div className="mt-6 border-t border-niebla pt-4">
          {conDesglose ? (
            <Desglose cot={cot} trm={trm?.valor ?? null} />
          ) : (
            <p className="flex items-baseline justify-between gap-4">
              <span className="font-medium text-verde">Total</span>
              <span className="text-h3 font-bold text-verde">
                <Precio cop={cot.total} trm={trm?.valor ?? null} />
              </span>
            </p>
          )}
          <NotaMoneda trm={trm} className="mt-3" />
        </div>
      )}
      {children}
    </aside>
  );
}

export const claseCampo = (error: boolean) =>
  `h-12 w-full rounded-card border bg-blanco px-4 text-base text-cafe outline-none focus:border-verde focus:ring-2 focus:ring-verde/20 ${
    error ? "border-terracota-oscuro" : "border-niebla"
  }`;

export function Campo({
  id,
  etiqueta,
  ayuda,
  error,
  className = "",
  children,
}: {
  id: string;
  etiqueta: string;
  ayuda?: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-small font-medium text-verde">
        {etiqueta}
      </label>
      <div className="mt-2">{children}</div>
      {ayuda && !error && (
        <p id={`${id}-ayuda`} className="mt-1 text-small">
          {ayuda}
        </p>
      )}
      {error && (
        <p
          id={`${id}-error`}
          className="mt-1 flex items-center gap-1 text-small text-terracota-oscuro"
        >
          <CircleAlert size={16} strokeWidth={1.5} aria-hidden /> {error}
        </p>
      )}
    </div>
  );
}

export function CuentaRegresiva({
  expiraEn,
  onVencer,
}: {
  expiraEn: string;
  onVencer: () => void;
}) {
  const [restante, setRestante] = useState(() => new Date(expiraEn).getTime() - Date.now());
  const vencio = useRef(false);

  useEffect(() => {
    const id = setInterval(() => setRestante(new Date(expiraEn).getTime() - Date.now()), 1000);
    return () => clearInterval(id);
  }, [expiraEn]);

  useEffect(() => {
    if (restante <= 0 && !vencio.current) {
      vencio.current = true;
      onVencer();
    }
  }, [restante, onVencer]);

  const s = Math.max(0, Math.floor(restante / 1000));
  return (
    <span className="font-bold tabular-nums">
      {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Flujo
// ---------------------------------------------------------------------------

export function FlujoReserva({
  config,
  tiposDocumento,
  trm,
  hoy,
  paypal,
}: {
  config: ConfigFlujo;
  /** TIPOS_DOCUMENTO de backend/src/reservas.ts (el cliente no puede importar ese módulo). */
  tiposDocumento: Readonly<Record<TipoDocumento, string>>;
  trm: Trm | null;
  hoy: string;
  /** Null si PayPal no está configurado o no hay TRM utilizable. */
  paypal: ClientePaypal | null;
}) {
  const router = useRouter();
  const [paso, setPaso] = useState(1);
  const [llegada, setLlegada] = useState<string>();
  const [salida, setSalida] = useState<string>();
  const [huespedes, setHuespedes] = useState(
    Math.min(config.huespedesIncluidos, config.maxHuespedes),
  );
  // Solo cuentan con el grupo base completo; si baja de maxHuespedes se descartan.
  const [adicionalesElegidos, setAdicionales] = useState<Adicionales>(SIN_ADICIONALES);
  const grupoCompleto = huespedes >= config.maxHuespedes && config.maxAdicionales > 0;
  const adicionales = grupoCompleto ? adicionalesElegidos : SIN_ADICIONALES;
  const lugaresLibres = config.maxAdicionales - totalAdicionales(adicionales);
  const [cotizacion, setCotizacion] = useState<ResultadoCotizacion | null>(null);
  const [cotizando, setCotizando] = useState(false);
  const [datos, setDatos] = useState<Datos>(datosIniciales);
  const [errores, setErrores] = useState<Errores>({});
  const [aviso, setAviso] = useState<string | null>(null);
  const [reserva, setReserva] = useState<{ codigo: string; expiraEn: string } | null>(null);
  const [holdVencido, setHoldVencido] = useState(false);
  const [version, setVersion] = useState(0);
  const [enviando, iniciar] = useTransition();
  const titulo = useRef<HTMLHeadingElement>(null);
  const montado = useRef(false);

  const trmValor = trm?.valor ?? null;
  const cot = cotizacion?.ok ? cotizacion : null;

  // Cotización en el servidor cada vez que cambian fechas o huéspedes.
  const { adultos, ninos, menores } = adicionales;
  useEffect(() => {
    if (!llegada || !salida) {
      setCotizacion(null);
      return;
    }
    let vigente = true;
    setCotizando(true);
    cotizar({ llegada, salida, huespedes, adicionales: { adultos, ninos, menores } })
      .then((r) => vigente && setCotizacion(r))
      .catch(
        () => vigente && setAviso("No pudimos calcular el precio. Intenta de nuevo en un momento."),
      )
      .finally(() => vigente && setCotizando(false));
    return () => {
      vigente = false;
    };
  }, [llegada, salida, huespedes, adultos, ninos, menores]);

  // Al cambiar de paso: subir y llevar el foco al título (lectores de pantalla).
  useEffect(() => {
    if (!montado.current) {
      montado.current = true;
      return;
    }
    window.scrollTo({ top: 0 });
    titulo.current?.focus();
  }, [paso]);

  async function irA(destino: number) {
    setAviso(null);
    if (reserva && destino < 4) {
      await liberarReserva(reserva.codigo);
      setReserva(null);
    }
    setPaso(destino);
  }

  function cambiarAdicional(tipo: keyof Adicionales, valor: number) {
    setAdicionales({ ...adicionales, [tipo]: Math.max(0, valor) });
  }

  function cambiarFechas(l?: string, s?: string) {
    setAviso(null);
    setLlegada(l);
    setSalida(s);
  }

  function actualizar<K extends keyof Datos>(campo: K, valor: Datos[K]) {
    setDatos((d) => ({ ...d, [campo]: valor }));
    setErrores((e) => ({ ...e, [campo]: undefined }));
  }

  function enviarDatos(e: React.FormEvent) {
    e.preventDefault();
    if (!llegada || !salida) return;
    setAviso(null);
    iniciar(async () => {
      const r = await crearReserva({ llegada, salida, huespedes, adicionales }, datos);
      if (r.ok) {
        setReserva({ codigo: r.codigo, expiraEn: r.expiraEn });
        setCotizacion(r.cotizacion);
        setHoldVencido(false);
        setErrores({});
        setPaso(4);
        return;
      }
      if (r.error === "datos_invalidos") {
        setErrores(r.errores);
        const primero = Object.keys(r.errores)[0];
        if (primero) document.getElementById(`campo-${primero}`)?.focus();
        return;
      }
      setAviso(mensajeError(r, config.maxHuespedes));
      if (
        r.error === "no_disponible" ||
        r.error === "minimo_noches" ||
        r.error === "fechas_invalidas"
      ) {
        setVersion((v) => v + 1);
        setSalida(undefined);
        setPaso(1);
      }
    });
  }

  const err = (campo: keyof Datos) => errores[campo]?.[0];
  const describe = (campo: string, conAyuda = false) =>
    errores[campo]?.[0] ? `campo-${campo}-error` : conAyuda ? `campo-${campo}-ayuda` : undefined;

  const tituloPaso = (texto: string) => (
    <h2 ref={titulo} tabIndex={-1} className="font-serif text-h2 text-verde outline-none">
      {texto}
    </h2>
  );

  const navegacion = (anterior: { texto: string; paso: number }, siguiente: React.ReactNode) => (
    <div className="mt-8 flex flex-col-reverse gap-4 sm:flex-row sm:items-center sm:justify-between">
      <button type="button" onClick={() => irA(anterior.paso)} className={claseBoton("secundario")}>
        <ArrowLeft size={20} strokeWidth={1.5} aria-hidden /> {anterior.texto}
      </button>
      {siguiente}
    </div>
  );

  return (
    <section aria-labelledby="reserva-titulo" className="py-12 md:py-16">
      <Container>
        <p className="text-overline font-medium text-terracota-oscuro">RESERVAS</p>
        <h1 id="reserva-titulo" className="mt-2 font-serif text-h1 text-verde">
          Reserva tu refugio
        </h1>
        <div className="mt-6 overflow-x-auto">
          <PasosReserva actual={paso} onIr={paso < 5 ? irA : undefined} />
        </div>

        <div className="mt-8 grid gap-8 lg:grid-cols-12 lg:items-start">
          <div className="lg:col-span-8">
            {/* Paso 1 · Fechas */}
            {paso === 1 && (
              <div>
                {tituloPaso("Elige tus fechas")}
                <p className="mt-2 max-w-[65ch]">
                  Toca el día de llegada y luego el de salida. Debajo de cada día ves el precio de
                  esa noche.
                </p>
                <div className="mt-6">
                  <Calendario
                    hoy={hoy}
                    llegada={llegada}
                    salida={salida}
                    incluidos={config.huespedesIncluidos}
                    trm={trmValor}
                    version={version}
                    onCambio={cambiarFechas}
                  />
                </div>
                <p className="mt-4 flex max-w-[65ch] items-start gap-3 rounded-card border border-miel bg-blanco p-4 text-small">
                  <Clock size={20} strokeWidth={1.5} className="shrink-0 text-verde" aria-hidden />
                  <span>
                    <strong className="font-medium text-verde">Entrada (check-in):</strong> desde
                    las {formatoHora(config.horaCheckin)} ·{" "}
                    <strong className="font-medium text-verde">Salida (check-out):</strong> hasta
                    las {formatoHora(config.horaCheckout)}
                  </span>
                </p>
                {cotizacion && !cotizacion.ok && (
                  <Aviso>{mensajeError(cotizacion, config.maxHuespedes)}</Aviso>
                )}
                {aviso && <Aviso>{aviso}</Aviso>}
              </div>
            )}

            {/* Paso 2 · Huéspedes */}
            {paso === 2 && (
              <div>
                {tituloPaso("¿Cuántas personas vienen?")}
                <p className="mt-2">De 1 a {config.maxHuespedes} personas, de cualquier edad.</p>
                <p className="mt-4 flex max-w-[65ch] items-start gap-3 rounded-card border border-miel bg-blanco p-4 text-small">
                  <PawPrint
                    size={20}
                    strokeWidth={1.5}
                    className="shrink-0 text-verde"
                    aria-hidden
                  />
                  <span>
                    <strong className="font-medium text-verde">Lauburu no admite mascotas.</strong>{" "}
                    Si viajas con la tuya, te recomendamos dejarla al cuidado de alguien de
                    confianza para que disfrutes tu estadía con tranquilidad.
                  </span>
                </p>

                <div className="mt-6 flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => setHuespedes((h) => Math.max(1, h - 1))}
                    disabled={huespedes <= 1}
                    aria-label="Quitar una persona"
                    className="inline-flex size-12 items-center justify-center rounded-full border-[1.5px] border-verde text-verde transition-colors duration-200 hover:bg-verde hover:text-crema disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-verde"
                  >
                    <Minus size={20} strokeWidth={1.5} />
                  </button>
                  <output
                    aria-live="polite"
                    className="min-w-24 text-center text-h2 font-serif text-verde"
                  >
                    {huespedes}
                    <span className="block text-small font-sans text-cafe">
                      {huespedes === 1 ? "persona" : "personas"}
                    </span>
                  </output>
                  <button
                    type="button"
                    onClick={() => setHuespedes((h) => Math.min(config.maxHuespedes, h + 1))}
                    disabled={huespedes >= config.maxHuespedes}
                    aria-label="Agregar una persona"
                    className="inline-flex size-12 items-center justify-center rounded-full border-[1.5px] border-verde text-verde transition-colors duration-200 hover:bg-verde hover:text-crema disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-verde"
                  >
                    <Plus size={20} strokeWidth={1.5} />
                  </button>
                </div>

                <p className="mt-6 max-w-[65ch] rounded-card border border-miel bg-blanco p-4 text-small">
                  La tarifa incluye {config.huespedesIncluidos} personas. Desde la persona{" "}
                  {config.huespedesIncluidos + 1}, se suma un valor adicional por persona y por
                  noche
                  {cot && cot.noches[0] ? (
                    <>
                      {" "}
                      (<Precio cop={cot.noches[0].precioPersonaExtra} trm={trmValor} />
                      {cot.noches.some(
                        (n) => n.precioPersonaExtra !== cot.noches[0]!.precioPersonaExtra,
                      )
                        ? " la primera noche; varía en temporada"
                        : ""}
                      )
                    </>
                  ) : null}
                  .
                  {config.maxAdicionales > 0 && !grupoCompleto && (
                    <>
                      {" "}
                      ¿Son más de {config.maxHuespedes}? Al llegar a {config.maxHuespedes} personas
                      puedes sumar acompañantes adicionales.
                    </>
                  )}
                </p>

                {grupoCompleto && (
                  <fieldset className="mt-6 rounded-card border border-niebla bg-blanco p-5 md:p-6">
                    <legend className="px-2 font-serif text-h3 text-verde">
                      ¿Vienen más personas?
                    </legend>
                    <p className="text-small">
                      Además de las {config.maxHuespedes} personas puedes sumar hasta{" "}
                      {config.maxAdicionales} acompañantes, contando a los menores de 4 años.{" "}
                      {lugaresLibres === 0
                        ? "Ya no quedan lugares."
                        : `${lugaresLibres === 1 ? "Queda 1 lugar" : `Quedan ${lugaresLibres} lugares`}.`}
                    </p>
                    <ul className="mt-4 divide-y divide-niebla">
                      {(
                        [
                          {
                            tipo: "adultos",
                            titulo: "Adultos",
                            precio: (
                              <>
                                <Precio cop={config.precioAdicionalAdulto} trm={trmValor} /> por
                                noche, con desayuno
                              </>
                            ),
                          },
                          {
                            tipo: "ninos",
                            titulo: "Niños de 4 a 11 años",
                            precio: (
                              <>
                                <Precio cop={config.precioAdicionalNino} trm={trmValor} /> por noche
                              </>
                            ),
                          },
                          { tipo: "menores", titulo: "Menores de 4 años", precio: "Gratis" },
                        ] as const
                      ).map(({ tipo, titulo, precio }) => (
                        <li
                          key={tipo}
                          className="flex flex-wrap items-center justify-between gap-4 py-3"
                        >
                          <span>
                            <span className="block font-medium text-verde">{titulo}</span>
                            <span className="block text-small">{precio}</span>
                          </span>
                          <Contador
                            etiqueta={`${titulo} adicionales`}
                            valor={adicionales[tipo]}
                            min={0}
                            max={adicionales[tipo] + lugaresLibres}
                            onCambio={(v) => cambiarAdicional(tipo, v)}
                          />
                        </li>
                      ))}
                    </ul>
                  </fieldset>
                )}

                <div
                  className="mt-6 rounded-card border border-niebla bg-blanco p-5 md:p-6"
                  aria-busy={cotizando}
                >
                  <h3 className="font-serif text-h3 text-verde">Desglose por noche</h3>
                  <div className="mt-4">
                    {cot ? (
                      <Desglose cot={cot} trm={trmValor} />
                    ) : (
                      <p className="text-small">Calculando…</p>
                    )}
                  </div>
                </div>
                {cotizacion && !cotizacion.ok && (
                  <Aviso>{mensajeError(cotizacion, config.maxHuespedes)}</Aviso>
                )}

                {navegacion(
                  { texto: "Volver a fechas", paso: 1 },
                  <button
                    type="button"
                    disabled={!cot || cotizando}
                    onClick={() => irA(3)}
                    className={claseBoton("primario")}
                  >
                    Continuar a tus datos <ArrowRight size={20} strokeWidth={1.5} aria-hidden />
                  </button>,
                )}
              </div>
            )}

            {/* Paso 3 · Datos */}
            {paso === 3 && (
              <form onSubmit={enviarDatos} noValidate>
                {tituloPaso("Tus datos")}
                <p className="mt-2 max-w-[65ch]">
                  Los de la persona que hace la reserva. Solo los usamos para tu estadía.
                </p>

                <div className="mt-6 grid gap-6 sm:grid-cols-2">
                  <Campo
                    id="campo-nombre"
                    etiqueta="Nombre completo"
                    ayuda="Como aparece en tu documento"
                    error={err("nombre")}
                    className="sm:col-span-2"
                  >
                    <input
                      id="campo-nombre"
                      autoComplete="name"
                      value={datos.nombre}
                      onChange={(e) => actualizar("nombre", e.target.value)}
                      aria-invalid={!!err("nombre")}
                      aria-describedby={describe("nombre", true)}
                      className={claseCampo(!!err("nombre"))}
                    />
                  </Campo>

                  <Campo
                    id="campo-tipoDocumento"
                    etiqueta="Tipo de documento"
                    error={err("tipoDocumento")}
                  >
                    <select
                      id="campo-tipoDocumento"
                      value={datos.tipoDocumento}
                      onChange={(e) => actualizar("tipoDocumento", e.target.value)}
                      aria-invalid={!!err("tipoDocumento")}
                      aria-describedby={describe("tipoDocumento")}
                      className={claseCampo(!!err("tipoDocumento"))}
                    >
                      <option value="">Elige una opción</option>
                      {Object.entries(tiposDocumento).map(([valor, texto]) => (
                        <option key={valor} value={valor}>
                          {texto}
                        </option>
                      ))}
                    </select>
                  </Campo>

                  <Campo
                    id="campo-documento"
                    etiqueta="Número de documento"
                    error={err("documento")}
                  >
                    <input
                      id="campo-documento"
                      value={datos.documento}
                      onChange={(e) => actualizar("documento", e.target.value)}
                      aria-invalid={!!err("documento")}
                      aria-describedby={describe("documento")}
                      className={claseCampo(!!err("documento"))}
                    />
                  </Campo>

                  <Campo
                    id="campo-correo"
                    etiqueta="Correo electrónico"
                    ayuda="Aquí te enviamos la confirmación"
                    error={err("correo")}
                  >
                    <input
                      id="campo-correo"
                      type="email"
                      autoComplete="email"
                      value={datos.correo}
                      onChange={(e) => actualizar("correo", e.target.value)}
                      aria-invalid={!!err("correo")}
                      aria-describedby={describe("correo", true)}
                      className={claseCampo(!!err("correo"))}
                    />
                  </Campo>

                  <Campo
                    id="campo-telefono"
                    etiqueta="Celular o WhatsApp"
                    ayuda="Para enviarte las indicaciones de llegada"
                    error={err("telefono")}
                  >
                    <input
                      id="campo-telefono"
                      type="tel"
                      autoComplete="tel"
                      value={datos.telefono}
                      onChange={(e) => actualizar("telefono", e.target.value)}
                      aria-invalid={!!err("telefono")}
                      aria-describedby={describe("telefono", true)}
                      className={claseCampo(!!err("telefono"))}
                    />
                  </Campo>

                  <Campo id="campo-pais" etiqueta="País" error={err("pais")}>
                    <input
                      id="campo-pais"
                      autoComplete="country-name"
                      value={datos.pais}
                      onChange={(e) => actualizar("pais", e.target.value)}
                      aria-invalid={!!err("pais")}
                      aria-describedby={describe("pais")}
                      className={claseCampo(!!err("pais"))}
                    />
                  </Campo>

                  <Campo id="campo-ciudad" etiqueta="Ciudad (opcional)" error={err("ciudad")}>
                    <input
                      id="campo-ciudad"
                      autoComplete="address-level2"
                      value={datos.ciudad}
                      onChange={(e) => actualizar("ciudad", e.target.value)}
                      aria-invalid={!!err("ciudad")}
                      aria-describedby={describe("ciudad")}
                      className={claseCampo(!!err("ciudad"))}
                    />
                  </Campo>

                  <Campo
                    id="campo-comentarios"
                    etiqueta="Comentarios o peticiones especiales (opcional)"
                    ayuda={`Hora estimada de llegada, alimentación, celebraciones… ${datos.comentarios.length}/300`}
                    error={err("comentarios")}
                    className="sm:col-span-2"
                  >
                    <textarea
                      id="campo-comentarios"
                      rows={3}
                      maxLength={300}
                      value={datos.comentarios}
                      onChange={(e) => actualizar("comentarios", e.target.value)}
                      aria-invalid={!!err("comentarios")}
                      aria-describedby={describe("comentarios", true)}
                      className={`${claseCampo(!!err("comentarios"))} h-auto py-3`}
                    />
                  </Campo>
                </div>

                <div className="mt-6 space-y-4">
                  <div>
                    <label className="flex items-start gap-3">
                      <input
                        id="campo-aceptaTerminos"
                        type="checkbox"
                        checked={datos.aceptaTerminos}
                        onChange={(e) => actualizar("aceptaTerminos", e.target.checked)}
                        aria-invalid={!!err("aceptaTerminos")}
                        aria-describedby={describe("aceptaTerminos")}
                        className="mt-1 size-5 shrink-0 accent-verde"
                      />
                      <span>
                        Acepto los{" "}
                        <a href="/terminos" target="_blank" className={claseBoton("texto")}>
                          términos y condiciones
                        </a>{" "}
                        y la política de cancelación.
                      </span>
                    </label>
                    {err("aceptaTerminos") && (
                      <p
                        id="campo-aceptaTerminos-error"
                        className="mt-1 flex items-center gap-1 text-small text-terracota-oscuro"
                      >
                        <CircleAlert size={16} strokeWidth={1.5} aria-hidden />{" "}
                        {err("aceptaTerminos")}
                      </p>
                    )}
                  </div>
                  <label className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={datos.aceptaMarketing}
                      onChange={(e) => actualizar("aceptaMarketing", e.target.checked)}
                      className="mt-1 size-5 shrink-0 accent-verde"
                    />
                    <span>
                      Quiero recibir novedades y tarifas especiales por correo.{" "}
                      <span className="text-small">
                        (Opcional, puedes darte de baja cuando quieras.)
                      </span>
                    </span>
                  </label>
                </div>

                {aviso && <Aviso>{aviso}</Aviso>}

                {navegacion(
                  { texto: "Volver a huéspedes", paso: 2 },
                  <button type="submit" disabled={enviando} className={claseBoton("primario")}>
                    {enviando ? "Apartando tus fechas…" : "Continuar al pago"}
                    {!enviando && <ArrowRight size={20} strokeWidth={1.5} aria-hidden />}
                  </button>,
                )}
              </form>
            )}

            {/* Paso 4 · Pago */}
            {paso === 4 && reserva && cot && (
              <div>
                {tituloPaso("Pago")}

                {holdVencido ? (
                  <div className="mt-6 rounded-card border border-terracota-oscuro bg-blanco p-5 md:p-6">
                    <p className="font-medium text-terracota-oscuro">
                      Se acabó el tiempo para pagar y liberamos tus fechas.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setReserva(null);
                        setVersion((v) => v + 1);
                        setPaso(1);
                      }}
                      className={`${claseBoton("primario")} mt-4`}
                    >
                      Elegir fechas de nuevo
                    </button>
                  </div>
                ) : (
                  <p className="mt-4 flex items-start gap-3 rounded-card border border-miel bg-blanco p-4">
                    <Clock
                      size={24}
                      strokeWidth={1.5}
                      className="shrink-0 text-verde"
                      aria-hidden
                    />
                    <span>
                      Apartamos tus fechas por {config.minutosHold} minutos mientras completas el
                      pago. Tiempo restante:{" "}
                      <CuentaRegresiva
                        expiraEn={reserva.expiraEn}
                        onVencer={() => setHoldVencido(true)}
                      />
                      . Tu reserva queda confirmada cuando el pago sea aprobado.
                    </span>
                  </p>
                )}

                <MedioPaypal totalCop={cot.total} trm={trmValor} />
                {aviso && <Aviso>{aviso}</Aviso>}

                <div className="mt-8 flex flex-col-reverse gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <button type="button" onClick={() => irA(3)} className={claseBoton("secundario")}>
                    <ArrowLeft size={20} strokeWidth={1.5} aria-hidden /> Volver a tus datos
                  </button>
                  {paypal && !holdVencido && (
                    <BotonPaypal
                      paypal={paypal}
                      iniciar={() => iniciarPagoReserva(reserva.codigo)}
                      capturar={capturarPagoReserva}
                      alAprobar={() => router.push(`/reservas/confirmacion/${reserva.codigo}`)}
                      alError={setAviso}
                    />
                  )}
                </div>
                <p className="mt-4 max-w-[65ch] text-small">
                  {paypal
                    ? "¿Prefieres pagar en pesos colombianos? Escríbenos por "
                    : "El pago en línea no está disponible en este momento. Escríbenos por "}
                  <a
                    href={enlaceWhatsApp(
                      `Hola, quiero pagar mi reserva ${reserva.codigo} en Lauburu Glamping`,
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={claseBoton("texto")}
                  >
                    WhatsApp
                  </a>{" "}
                  con tu código <strong className="font-medium text-verde">{reserva.codigo}</strong>{" "}
                  y te ayudamos a completar la reserva.
                </p>
              </div>
            )}
          </div>

          <div className="lg:col-span-4">
            <Resumen
              config={config}
              llegada={llegada}
              salida={salida}
              huespedes={huespedes}
              adicionales={adicionales}
              cot={cot}
              trm={trm}
              conDesglose={paso === 1}
            >
              {paso === 1 && (
                <div className="mt-6 flex flex-col gap-3">
                  <button
                    type="button"
                    disabled={!cot || cotizando}
                    onClick={() => irA(2)}
                    className={`${claseBoton("primario")} w-full`}
                  >
                    Continuar a huéspedes <ArrowRight size={20} strokeWidth={1.5} aria-hidden />
                  </button>
                  {llegada && (
                    <button
                      type="button"
                      onClick={() => cambiarFechas(undefined, undefined)}
                      className={`${claseBoton("texto")} self-center`}
                    >
                      Limpiar fechas
                    </button>
                  )}
                </div>
              )}
            </Resumen>
          </div>
        </div>
      </Container>
    </section>
  );
}
