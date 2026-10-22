"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { Container } from "./Container";
import { SelectorMoneda } from "./Moneda";
import { claseBoton } from "./ui";
import { BotonCarrito } from "./servicios/Carrito";
import { navegacion, secciones } from "@/lib/sitio";

const enlaceMenu =
  "decoration-miel decoration-2 underline-offset-8 hover:underline aria-[current=page]:underline";

export function Header() {
  const pathname = usePathname();
  const [abierto, setAbierto] = useState(false);
  const [conScroll, setConScroll] = useState(false);

  useEffect(() => {
    const alHacerScroll = () => setConScroll(window.scrollY > 0);
    alHacerScroll();
    window.addEventListener("scroll", alHacerScroll, { passive: true });
    return () => window.removeEventListener("scroll", alHacerScroll);
  }, []);

  // Cierra el menú móvil al navegar y con Esc.
  useEffect(() => setAbierto(false), [pathname]);
  useEffect(() => {
    if (!abierto) return;
    const alPresionar = (e: KeyboardEvent) => e.key === "Escape" && setAbierto(false);
    document.addEventListener("keydown", alPresionar);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", alPresionar);
      document.body.style.overflow = "";
    };
  }, [abierto]);

  const esActivo = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  // Las anclas (/#seccion) no cambian el pathname: el menú se cierra al hacer clic.
  const cerrar = () => setAbierto(false);

  return (
    <header
      className={`on-dark sticky top-0 z-50 bg-verde text-crema transition-shadow duration-200 ease-out ${conScroll ? "shadow-soft" : ""}`}
    >
      <Container className="flex h-16 items-center justify-between gap-4 md:h-18">
        {/* TODO(marca): agregar el símbolo simplificado de public/brand/ (32–40 px) cuando llegue el archivo. */}
        <Link href="/" className="font-serif text-h3 tracking-wide">
          LAUBURU
        </Link>

        <nav aria-label="Principal" className="hidden lg:block">
          <ul className="flex items-center gap-8">
            {navegacion.map(({ href, texto }) => (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={esActivo(href) ? "page" : undefined}
                  className={`text-menu ${enlaceMenu}`}
                >
                  {texto}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex items-center gap-2 lg:gap-4">
          <SelectorMoneda className="hidden lg:inline-flex" />
          <BotonCarrito />
          <Link href="/reservas" className={claseBoton("primario", "compacto")}>
            Reservar
          </Link>
          <button
            type="button"
            className="inline-flex size-11 items-center justify-center rounded-full lg:hidden"
            aria-expanded={abierto}
            aria-controls="menu-movil"
            aria-label={abierto ? "Cerrar menú" : "Abrir menú"}
            onClick={() => setAbierto((v) => !v)}
          >
            {abierto ? <X size={24} strokeWidth={1.5} /> : <Menu size={24} strokeWidth={1.5} />}
          </button>
        </div>
      </Container>

      {abierto && (
        <nav
          id="menu-movil"
          aria-label="Principal"
          className="fixed inset-x-0 top-16 bottom-0 overflow-y-auto bg-verde lg:hidden"
        >
          <Container className="py-6">
            <ul>
              {navegacion.map(({ href, texto }) => (
                <li key={href} className="border-b border-verde-hoja">
                  <Link
                    href={href}
                    onClick={cerrar}
                    aria-current={esActivo(href) ? "page" : undefined}
                    className={`block py-4 text-body ${enlaceMenu}`}
                  >
                    {texto}
                  </Link>
                </li>
              ))}
            </ul>

            <p className="mt-8 text-overline font-medium text-miel">EN NOSOTROS</p>
            <ul className="mt-2">
              {secciones.map(({ href, texto }) => (
                <li key={href}>
                  <Link href={href} onClick={cerrar} className={`block py-3 ${enlaceMenu}`}>
                    {texto}
                  </Link>
                </li>
              ))}
            </ul>

            <p className="mt-8 text-overline font-medium text-miel">VER PRECIOS EN</p>
            <SelectorMoneda className="mt-3" />
          </Container>
        </nav>
      )}
    </header>
  );
}
