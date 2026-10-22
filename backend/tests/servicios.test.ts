import { describe, expect, it } from "vitest";
import {
  claveCupo,
  cotizarCarrito,
  type Disponibilidad,
  type ItemCarrito,
  type ServicioCatalogo,
} from "../src/servicios";

const HOY = "2026-10-21";

const cabalgata: ServicioCatalogo = {
  id: 1,
  slug: "cabalgata-al-mirador",
  nombre: "Cabalgata al mirador",
  precio: 85_000,
  unidadPrecio: "persona",
  tipoStock: "cupos",
  stock: null,
  maxPorPedido: 4,
  incluidoOExtra: "extra",
  activo: true,
  turnos: ["09:00", "15:00"],
};

const cena: ServicioCatalogo = {
  id: 2,
  slug: "cena-junto-a-la-fogata",
  nombre: "Cena junto a la fogata",
  precio: 180_000,
  unidadPrecio: "pareja",
  tipoStock: "cupos",
  stock: null,
  maxPorPedido: 3,
  incluidoOExtra: "extra",
  activo: true,
  turnos: [], // sin turnos: un cupo por fecha
};

const kitCelebracion: ServicioCatalogo = {
  id: 3,
  slug: "kit-de-celebracion",
  nombre: "Kit de celebración",
  precio: 120_000,
  unidadPrecio: "unidad",
  tipoStock: "unidades",
  stock: 5,
  maxPorPedido: 2,
  incluidoOExtra: "extra",
  activo: true,
  turnos: [],
};

const cafeBienvenida: ServicioCatalogo = {
  ...cena,
  id: 4,
  slug: "cafe-de-bienvenida",
  nombre: "Café de bienvenida",
  precio: 0,
  incluidoOExtra: "incluido",
};

const inactivo: ServicioCatalogo = { ...cabalgata, id: 5, slug: "inactivo", activo: false };

const catalogo = new Map(
  [cabalgata, cena, kitCelebracion, cafeBienvenida, inactivo].map((s) => [s.id, s]),
);

function disponibilidad(
  cupos: [number, string, string, number][] = [],
  unidades: [number, number][] = [],
): Disponibilidad {
  return {
    cupos: new Map(
      cupos.map(([id, fecha, turno, libres]) => [claveCupo(id, fecha, turno), libres]),
    ),
    unidades: new Map(unidades),
  };
}

const dispBase = disponibilidad(
  [
    [1, "2026-10-23", "09:00", 4],
    [1, "2026-10-23", "15:00", 1],
    [1, "2026-10-24", "09:00", 0],
    [2, "2026-10-23", "", 2],
  ],
  [[3, 5]],
);

const item = (
  servicioId: number,
  fecha: string | null,
  turno: string | null,
  cantidad: number,
): ItemCarrito => ({
  servicioId,
  fecha,
  turno,
  cantidad,
});

const opciones = { hoy: HOY, estadia: null };

describe("cotizarCarrito", () => {
  it("calcula precio × cantidad y el total con precios del catálogo", () => {
    const r = cotizarCarrito(
      [item(1, "2026-10-23", "09:00", 2), item(2, "2026-10-23", null, 1)],
      catalogo,
      dispBase,
      opciones,
    );
    expect(r.valido).toBe(true);
    expect(r.lineas.map((l) => [l.precioUnitario, l.subtotal, l.estado])).toEqual([
      [85_000, 170_000, "ok"],
      [180_000, 180_000, "ok"],
    ]);
    expect(r.total).toBe(350_000);
  });

  it("un carrito vacío no es válido", () => {
    expect(cotizarCarrito([], catalogo, dispBase, opciones)).toMatchObject({
      valido: false,
      total: 0,
      lineas: [],
    });
  });

  it("servicio inexistente, inactivo o incluido no se puede comprar", () => {
    const r = cotizarCarrito(
      [
        item(99, "2026-10-23", null, 1),
        item(5, "2026-10-23", "09:00", 1),
        item(4, "2026-10-23", null, 1),
      ],
      catalogo,
      dispBase,
      opciones,
    );
    expect(r.lineas.map((l) => l.estado)).toEqual(["no_existe", "inactivo", "incluido"]);
    expect(r).toMatchObject({ valido: false, total: 0 });
  });

  it("cantidad entre 1 y el máximo por pedido, entera", () => {
    const r = cotizarCarrito(
      [
        item(1, "2026-10-23", "09:00", 0),
        item(1, "2026-10-23", "09:00", 5),
        item(1, "2026-10-23", "09:00", 1.5),
      ],
      catalogo,
      dispBase,
      opciones,
    );
    expect(r.lineas.map((l) => l.estado)).toEqual([
      "cantidad_invalida",
      "cantidad_invalida",
      "cantidad_invalida",
    ]);
  });

  it("las líneas con error no suman al total", () => {
    const r = cotizarCarrito(
      [item(1, "2026-10-23", "09:00", 1), item(99, null, null, 1)],
      catalogo,
      dispBase,
      opciones,
    );
    expect(r).toMatchObject({ valido: false, total: 85_000 });
  });

  describe("servicios por cupos", () => {
    it("exige una fecha válida y no pasada", () => {
      const r = cotizarCarrito(
        [
          item(1, null, "09:00", 1),
          item(1, "2026-10-20", "09:00", 1),
          item(1, "2026-02-30", "09:00", 1),
        ],
        catalogo,
        dispBase,
        opciones,
      );
      expect(r.lineas.map((l) => l.estado)).toEqual([
        "fecha_invalida",
        "fecha_invalida",
        "fecha_invalida",
      ]);
    });

    it("el turno debe ser uno de los del servicio; sin turnos se ignora", () => {
      const r = cotizarCarrito(
        [
          item(1, "2026-10-23", "11:00", 1),
          item(1, "2026-10-23", null, 1),
          item(2, "2026-10-23", "09:00", 1),
        ],
        catalogo,
        dispBase,
        opciones,
      );
      expect(r.lineas.map((l) => l.estado)).toEqual(["turno_invalido", "turno_invalido", "ok"]);
      expect(r.lineas[2]).toMatchObject({ turno: null });
    });

    it("sin cupos para esa fecha y turno: agotado", () => {
      const r = cotizarCarrito(
        [item(1, "2026-10-24", "09:00", 1), item(1, "2026-10-25", "09:00", 1)],
        catalogo,
        dispBase,
        opciones,
      );
      expect(r.lineas.map((l) => l.estado)).toEqual(["agotado", "agotado"]);
    });

    it("pide más de lo disponible: sin_cupos_suficientes con lo que queda", () => {
      const r = cotizarCarrito([item(1, "2026-10-23", "15:00", 2)], catalogo, dispBase, opciones);
      expect(r.lineas[0]).toMatchObject({ estado: "sin_cupos_suficientes", disponible: 1 });
    });

    it("suma las cantidades de varias líneas del mismo cupo", () => {
      const r = cotizarCarrito(
        [item(1, "2026-10-23", "09:00", 3), item(1, "2026-10-23", "09:00", 2)],
        catalogo,
        dispBase,
        opciones,
      );
      expect(r.lineas.map((l) => l.estado)).toEqual(["ok", "sin_cupos_suficientes"]);
      expect(r.lineas[1]).toMatchObject({ disponible: 1 });
    });
  });

  describe("servicios por unidades", () => {
    it("valida contra el stock y la fecha es opcional", () => {
      const r = cotizarCarrito([item(3, null, null, 2)], catalogo, dispBase, opciones);
      expect(r).toMatchObject({ valido: true, total: 240_000 });
    });

    it("stock insuficiente sumando líneas", () => {
      const d = disponibilidad([], [[3, 3]]);
      const r = cotizarCarrito(
        [item(3, null, null, 2), item(3, "2026-10-23", null, 2)],
        catalogo,
        d,
        opciones,
      );
      expect(r.lineas.map((l) => l.estado)).toEqual(["ok", "sin_cupos_suficientes"]);
      expect(r.lineas[1]).toMatchObject({ disponible: 1 });
    });

    it("sin stock: agotado", () => {
      const r = cotizarCarrito(
        [item(3, null, null, 1)],
        catalogo,
        disponibilidad([], [[3, 0]]),
        opciones,
      );
      expect(r.lineas[0]).toMatchObject({ estado: "agotado" });
    });

    it("si trae fecha, debe ser válida", () => {
      const r = cotizarCarrito([item(3, "2026-10-01", null, 1)], catalogo, dispBase, opciones);
      expect(r.lineas[0]).toMatchObject({ estado: "fecha_invalida" });
    });
  });

  describe("con reserva vinculada", () => {
    const conEstadia = { hoy: HOY, estadia: { llegada: "2026-10-23", salida: "2026-10-25" } };

    it("acepta fechas desde la llegada hasta el día de salida, inclusive", () => {
      const d = disponibilidad([
        [1, "2026-10-23", "09:00", 4],
        [1, "2026-10-25", "09:00", 4],
      ]);
      const r = cotizarCarrito(
        [item(1, "2026-10-23", "09:00", 1), item(1, "2026-10-25", "09:00", 1)],
        catalogo,
        d,
        conEstadia,
      );
      expect(r.valido).toBe(true);
    });

    it("rechaza fechas fuera de la estadía", () => {
      const d = disponibilidad([
        [1, "2026-10-22", "09:00", 4],
        [1, "2026-10-26", "09:00", 4],
      ]);
      const r = cotizarCarrito(
        [item(1, "2026-10-22", "09:00", 1), item(1, "2026-10-26", "09:00", 1)],
        catalogo,
        d,
        conEstadia,
      );
      expect(r.lineas.map((l) => l.estado)).toEqual(["fuera_de_estadia", "fuera_de_estadia"]);
    });

    it("un servicio por unidades con fecha también debe caer en la estadía", () => {
      const r = cotizarCarrito([item(3, "2026-10-28", null, 1)], catalogo, dispBase, conEstadia);
      expect(r.lineas[0]).toMatchObject({ estado: "fuera_de_estadia" });
    });
  });
});
