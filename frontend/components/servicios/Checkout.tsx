"use client";

// Finalizar compra de servicios: datos del comprador → pedido pendiente (aparta cupos)
// → pasarela. El pago queda deshabilitado hasta integrar Wompi, Bold y PayPal.
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { ArrowLeft, ArrowRight, CircleAlert, Clock } from "lucide-react";
import type { ValidacionCarrito } from "@lauburu/backend/pedidos";
import {
  crearPedidoAccion,
  liberarPedidoAccion,
  validarCarritoAccion,
} from "@/app/servicios/acciones";
import { Precio, useMoneda } from "@/components/Moneda";
import {
  Aviso,
  Campo,
  CuentaRegresiva,
  PASARELAS,
  claseCampo,
  type Pasarela,
} from "@/components/reserva/FlujoReserva";
import { claseBoton } from "@/components/ui";

import { enlaceWhatsApp } from "@/lib/sitio";
import { cantidadTexto, cuandoTexto, formatoPrecio, problemaLinea } from "@/lib/formato";
import { itemsParaServidor, useCarrito, vinculo } from "./Carrito";

type Datos = {
  nombre: string;
  correo: string;
  telefono: string;
  comentarios: string;
  aceptaTerminos: boolean;
  aceptaMarketing: boolean;
};

export function Checkout({ minutosHold }: { minutosHold: number }) {
  const { items, reserva, vincular, abrir } = useCarrito();
  const { moneda, trm } = useMoneda();
  const [validacion, setValidacion] = useState<ValidacionCarrito | null>(null);
  const [datos, setDatos] = useState<Datos>({
    nombre: "",
    correo: reserva?.correo ?? "",
    telefono: "",
    comentarios: "",
    aceptaTerminos: false,
    aceptaMarketing: false,
  });
  const [errores, setErrores] = useState<Record<string, string[] | undefined>>({});
  const [aviso, setAviso] = useState<string | null>(null);
  const [pedido, setPedido] = useState<{ codigo: string; expiraEn: string } | null>(null);
  const [vencido, setVencido] = useState(false);
  const [pasarela, setPasarela] = useState<Pasarela>("wompi");
  const [enviando, iniciar] = useTransition();

  useEffect(() => {
    if (pedido) return;
    let vigente = true;
    validarCarritoAccion(itemsParaServidor(items), vinculo(reserva)).then(
      (v) => vigente && setValidacion(v),
    );
    return () => {
      vigente = false;
    };
  }, [items, reserva, pedido]);

  useEffect(() => {
    if (reserva && !datos.correo) setDatos((d) => ({ ...d, correo: reserva.correo }));
  }, [reserva, datos.correo]);

  if (items.length === 0 && !pedido) {
    return (
      <div className="rounded-card border border-niebla bg-blanco p-5 md:p-6">
        <p>Tu carrito está vacío.</p>
        <Link href="/servicios" className={`${claseBoton("secundario")} mt-4`}>
          Ver servicios
        </Link>
      </div>
    );
  }

  const err = (c: keyof Datos) => errores[c]?.[0];
  const describe = (c: string) => (errores[c]?.[0] ? `campo-${c}-error` : undefined);
  function actualizar<K extends keyof Datos>(campo: K, valor: Datos[K]) {
    setDatos((d) => ({ ...d, [campo]: valor }));
    setErrores((e) => ({ ...e, [campo]: undefined }));
  }

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    setAviso(null);
    iniciar(async () => {
      const r = await crearPedidoAccion(itemsParaServidor(items), datos, vinculo(reserva));
      if (r.ok) {
        setPedido({ codigo: r.codigo, expiraEn: r.expiraEn });
        setVencido(false);
        window.scrollTo({ top: 0 });
        return;
      }
      if (r.error === "datos_invalidos") {
        setErrores(r.errores);
        const primero = Object.keys(r.errores)[0];
        if (primero) document.getElementById(`campo-${primero}`)?.focus();
      } else if (r.error === "carrito_invalido") {
        if (r.carrito) setValidacion({ ...r.carrito, reserva: validacion?.reserva ?? null });
        setAviso("Algunos servicios cambiaron mientras comprabas. Revisa el carrito.");
      } else if (r.error === "reserva_invalida") {
        vincular(null);
        setAviso(
          "No pudimos verificar tu reserva. La desvinculamos; puedes comprar sin ella o vincularla de nuevo.",
        );
      } else {
        setAviso("La venta de servicios en línea aún no está habilitada. Escríbenos por WhatsApp.");
      }
    });
  }

  async function volver() {
    if (pedido) await liberarPedidoAccion(pedido.codigo);
    setPedido(null);
  }

  const lineas = validacion?.lineas ?? [];
  const valido = !!validacion?.valido && lineas.length === items.length;

  const resumen = (
    <aside
      aria-labelledby="resumen-pedido"
      className="rounded-card border border-niebla bg-blanco p-5 md:p-6 lg:sticky lg:top-24"
    >
      <h2 id="resumen-pedido" className="font-serif text-h3 text-verde">
        Tu pedido
      </h2>
      {reserva && (
        <p className="mt-2 text-small">
          Vinculado a la reserva{" "}
          <strong className="font-medium text-verde">{reserva.codigo}</strong>
        </p>
      )}
      <ul className="mt-4 divide-y divide-niebla">
        {items.map((item, i) => {
          const linea = lineas[i];
          const problema = linea ? problemaLinea(linea.estado, linea.disponible) : null;
          return (
            <li key={`${item.servicioId}-${item.fecha}-${item.turno}`} className="py-3 text-small">
              <div className="flex items-baseline justify-between gap-4">
                <span className="font-medium text-verde">{item.nombre}</span>
                {linea?.estado === "ok" && (
                  <span className="shrink-0 font-medium text-verde">
                    <Precio cop={linea.subtotal} />
                  </span>
                )}
              </div>
              <p>
                {cuandoTexto(item.fecha, item.turno)} ·{" "}
                {cantidadTexto(item.cantidad, item.unidadPrecio)}
              </p>
              {problema && <p className="mt-1 text-terracota-oscuro">{problema}</p>}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 flex items-baseline justify-between gap-4 border-t border-verde pt-3">
        <span className="font-medium text-verde">Total</span>
        <span className="text-h3 font-bold text-verde">
          {validacion ? <Precio cop={validacion.total} /> : "…"}
        </span>
      </p>
      {!pedido && (
        <button type="button" onClick={abrir} className={`${claseBoton("texto")} mt-4 text-small`}>
          Editar carrito
        </button>
      )}
    </aside>
  );

  return (
    <div className="grid gap-8 lg:grid-cols-12 lg:items-start">
      <div className="lg:col-span-8">
        {!pedido ? (
          <form onSubmit={enviar} noValidate>
            <h2 className="font-serif text-h2 text-verde">Tus datos</h2>
            <p className="mt-2 max-w-[65ch]">
              Los usamos para confirmarte el pedido y avisar al aliado que presta el servicio.
            </p>

            <div className="mt-6 grid gap-6 sm:grid-cols-2">
              <Campo
                id="campo-nombre"
                etiqueta="Nombre completo"
                error={err("nombre")}
                className="sm:col-span-2"
              >
                <input
                  id="campo-nombre"
                  autoComplete="name"
                  value={datos.nombre}
                  onChange={(e) => actualizar("nombre", e.target.value)}
                  aria-invalid={!!err("nombre")}
                  aria-describedby={describe("nombre")}
                  className={claseCampo(!!err("nombre"))}
                />
              </Campo>
              <Campo id="campo-correo" etiqueta="Correo electrónico" error={err("correo")}>
                <input
                  id="campo-correo"
                  type="email"
                  autoComplete="email"
                  value={datos.correo}
                  onChange={(e) => actualizar("correo", e.target.value)}
                  aria-invalid={!!err("correo")}
                  aria-describedby={describe("correo")}
                  className={claseCampo(!!err("correo"))}
                />
              </Campo>
              <Campo id="campo-telefono" etiqueta="Celular o WhatsApp" error={err("telefono")}>
                <input
                  id="campo-telefono"
                  type="tel"
                  autoComplete="tel"
                  value={datos.telefono}
                  onChange={(e) => actualizar("telefono", e.target.value)}
                  aria-invalid={!!err("telefono")}
                  aria-describedby={describe("telefono")}
                  className={claseCampo(!!err("telefono"))}
                />
              </Campo>
              <Campo
                id="campo-comentarios"
                etiqueta="Comentarios para el aliado (opcional)"
                error={err("comentarios")}
                className="sm:col-span-2"
              >
                <textarea
                  id="campo-comentarios"
                  rows={3}
                  maxLength={300}
                  value={datos.comentarios}
                  onChange={(e) => actualizar("comentarios", e.target.value)}
                  aria-describedby={describe("comentarios")}
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
                    <CircleAlert size={16} strokeWidth={1.5} aria-hidden /> {err("aceptaTerminos")}
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
                  <span className="text-small">(Opcional.)</span>
                </span>
              </label>
            </div>

            {aviso && <Aviso>{aviso}</Aviso>}

            <div className="mt-8 flex flex-col-reverse gap-4 sm:flex-row sm:items-center sm:justify-between">
              <Link href="/servicios" className={claseBoton("secundario")}>
                <ArrowLeft size={20} strokeWidth={1.5} aria-hidden /> Seguir explorando
              </Link>
              <button
                type="submit"
                disabled={enviando || !valido}
                className={claseBoton("primario")}
              >
                {enviando ? "Apartando tus cupos…" : "Continuar al pago"}
                {!enviando && <ArrowRight size={20} strokeWidth={1.5} aria-hidden />}
              </button>
            </div>
          </form>
        ) : (
          <div>
            <h2 className="font-serif text-h2 text-verde">Pago</h2>
            {vencido ? (
              <div className="mt-6 rounded-card border border-terracota-oscuro bg-blanco p-5 md:p-6">
                <p className="font-medium text-terracota-oscuro">
                  Se acabó el tiempo para pagar y liberamos tus cupos.
                </p>
                <button
                  type="button"
                  onClick={() => setPedido(null)}
                  className={`${claseBoton("primario")} mt-4`}
                >
                  Intentar de nuevo
                </button>
              </div>
            ) : (
              <p className="mt-4 flex items-start gap-3 rounded-card border border-miel bg-blanco p-4">
                <Clock size={24} strokeWidth={1.5} className="shrink-0 text-verde" aria-hidden />
                <span>
                  Apartamos tus cupos por {minutosHold} minutos mientras completas el pago. Tiempo
                  restante:{" "}
                  <CuentaRegresiva expiraEn={pedido.expiraEn} onVencer={() => setVencido(true)} />.
                </span>
              </p>
            )}

            <fieldset className="mt-6">
              <legend className="font-serif text-h3 text-verde">¿Cómo quieres pagar?</legend>
              <div className="mt-4 space-y-3">
                {PASARELAS.map((p) => (
                  <label
                    key={p.id}
                    className={`flex cursor-pointer items-start gap-3 rounded-card border bg-blanco p-4 transition-colors duration-200 ${
                      pasarela === p.id
                        ? "border-verde ring-2 ring-verde/20"
                        : "border-niebla hover:border-verde"
                    }`}
                  >
                    <input
                      type="radio"
                      name="pasarela"
                      value={p.id}
                      checked={pasarela === p.id}
                      onChange={() => setPasarela(p.id)}
                      className="mt-1 size-5 shrink-0 accent-verde"
                    />
                    <span>
                      <span className="block font-medium text-verde">{p.nombre}</span>
                      <span className="block text-small">{p.detalle}</span>
                      {p.id === "paypal" && trm && validacion && (
                        <span className="mt-1 block text-small">
                          Cobro aproximado: {formatoPrecio(validacion.total, "USD", trm.valor)}.
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            {/* TODO(tarea pasarelas): integrar Wompi, Bold y PayPal según su documentación oficial. */}
            <div className="mt-8 flex flex-col-reverse gap-4 sm:flex-row sm:items-center sm:justify-between">
              <button type="button" onClick={volver} className={claseBoton("secundario")}>
                <ArrowLeft size={20} strokeWidth={1.5} aria-hidden /> Volver a tus datos
              </button>
              <button
                type="button"
                disabled
                aria-describedby="pago-pendiente"
                className={claseBoton("primario")}
              >
                Pagar{" "}
                {validacion ? formatoPrecio(validacion.total, moneda, trm?.valor ?? null) : ""}
              </button>
            </div>
            <p id="pago-pendiente" className="mt-4 max-w-[65ch] text-small">
              El pago en línea estará disponible muy pronto. Mientras tanto, escríbenos por{" "}
              <a
                href={enlaceWhatsApp(`Hola, quiero pagar mi pedido de servicios ${pedido.codigo}`)}
                target="_blank"
                rel="noopener noreferrer"
                className={claseBoton("texto")}
              >
                WhatsApp
              </a>{" "}
              con tu código <strong className="font-medium text-verde">{pedido.codigo}</strong>.
            </p>
          </div>
        )}
      </div>
      <div className="lg:col-span-4">{resumen}</div>
    </div>
  );
}

/** En la página del pedido: vacía el carrito cuando el pago ya está confirmado. */
export function VaciarCarritoSiConfirmado({ confirmado }: { confirmado: boolean }) {
  const { vaciar } = useCarrito();
  useEffect(() => {
    if (confirmado) vaciar();
  }, [confirmado, vaciar]);
  return null;
}
