"use client";

// Moneda en la que el visitante ve los precios. Solo cambia la presentación:
// los montos siempre vienen del servidor en COP y la TRM la entrega el servidor.
import { createContext, useContext, useEffect, useState } from "react";
import { formatoFecha, formatoPrecio, type Moneda } from "@/lib/formato";
import type { Trm } from "@lauburu/backend/moneda";

const CLAVE = "lauburu-moneda";

const MonedaContexto = createContext<{
  moneda: Moneda;
  setMoneda: (m: Moneda) => void;
  trm: Trm | null;
}>({
  moneda: "COP",
  setMoneda: () => {},
  trm: null,
});

export function MonedaProvider({ children, trm }: { children: React.ReactNode; trm: Trm | null }) {
  const [moneda, setMonedaEstado] = useState<Moneda>("COP");

  // La preferencia guardada se aplica después de hidratar (el HTML estático sale en COP).
  useEffect(() => {
    try {
      if (localStorage.getItem(CLAVE) === "USD") setMonedaEstado("USD");
    } catch {
      // Sin almacenamiento disponible: se queda en COP.
    }
  }, []);

  function setMoneda(m: Moneda) {
    setMonedaEstado(m);
    try {
      localStorage.setItem(CLAVE, m);
    } catch {}
  }

  return (
    <MonedaContexto.Provider value={{ moneda, setMoneda, trm }}>{children}</MonedaContexto.Provider>
  );
}

export function useMoneda() {
  return useContext(MonedaContexto);
}

/** Control "COP | USD" para fondos verdes (header). */
export function SelectorMoneda({ className = "" }: { className?: string }) {
  const { moneda, setMoneda } = useContext(MonedaContexto);
  return (
    <div
      role="group"
      aria-label="Ver precios en"
      className={`inline-flex rounded-full border border-verde-hoja p-1 ${className}`}
    >
      {(["COP", "USD"] as const).map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={moneda === m}
          onClick={() => setMoneda(m)}
          className="h-9 rounded-full px-3 text-menu transition-colors duration-200 aria-pressed:bg-crema aria-pressed:text-verde"
        >
          {m}
        </button>
      ))}
    </div>
  );
}

/** Monto en COP mostrado en la moneda elegida. Sin `trm`, usa la del contexto (layout). */
export function Precio({ cop, trm }: { cop: number; trm?: number | null }) {
  const contexto = useContext(MonedaContexto);
  const valor = trm !== undefined ? trm : (contexto.trm?.valor ?? null);
  return <>{formatoPrecio(cop, contexto.moneda, valor)}</>;
}

/** Aclaración que solo aparece cuando se ven precios en USD. */
export function NotaMoneda({ trm, className = "" }: { trm: Trm | null; className?: string }) {
  const { moneda } = useContext(MonedaContexto);
  if (moneda !== "USD") return null;
  return (
    <p className={`text-small ${className}`}>
      {trm
        ? `Valores en dólares aproximados con la TRM oficial del ${formatoFecha(trm.fecha)} ($${trm.valor.toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} COP por dólar). Los pagos en Colombia se cobran en pesos.`
        : "Por ahora no podemos mostrar la conversión a dólares; los valores se ven en pesos colombianos."}
    </p>
  );
}
