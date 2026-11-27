"use client";

// Elección de pasarela: Openpay (pesos colombianos, tarjeta o PSE) o PayPal (dólares).
// Si solo una está configurada, o `fijo` la elige (el depósito ya se autorizó con ella), se
// muestra directamente sin selector.
import { useId, useState } from "react";

type Opcion = "openpay" | "paypal";

const TEXTOS: Record<Opcion, { titulo: string; detalle: string }> = {
  openpay: {
    titulo: "Pesos colombianos",
    detalle: "Tarjeta de crédito o débito, o PSE (Openpay)",
  },
  paypal: { titulo: "Dólares", detalle: "Cuenta PayPal o tarjeta internacional" },
};

export function MedioPago({
  openpay,
  paypal,
  fijo = null,
}: {
  /** Contenido de cada medio, o null si no está disponible. */
  openpay: React.ReactNode | null;
  paypal: React.ReactNode | null;
  /** Pasarela obligatoria: el pago va por la misma del depósito. */
  fijo?: Opcion | null;
}) {
  const nombre = useId();
  const disponibles = (["openpay", "paypal"] as const).filter(
    (o) => (o === "openpay" ? openpay : paypal) && (!fijo || o === fijo),
  );
  const [elegido, setElegido] = useState<Opcion>(disponibles[0] ?? "openpay");
  if (disponibles.length === 0) return null;
  if (disponibles.length === 1) return <div className="mt-6">{disponibles[0] === "openpay" ? openpay : paypal}</div>;

  return (
    <div className="mt-6">
      <fieldset>
        <legend className="text-small font-medium text-verde">¿Cómo quieres pagar?</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {disponibles.map((opcion) => (
            <label
              key={opcion}
              className={`flex cursor-pointer items-start gap-3 rounded-card border bg-blanco p-4 transition-colors duration-200 ${
                elegido === opcion ? "border-verde" : "border-niebla hover:border-verde"
              }`}
            >
              <input
                type="radio"
                name={nombre}
                value={opcion}
                checked={elegido === opcion}
                onChange={() => setElegido(opcion)}
                className="mt-1 accent-verde"
              />
              <span>
                <span className="block font-medium text-verde">{TEXTOS[opcion].titulo}</span>
                <span className="block text-small">{TEXTOS[opcion].detalle}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="mt-4">{elegido === "openpay" ? openpay : paypal}</div>
    </div>
  );
}
