import Link from "next/link";
import { Container } from "./Container";
import { enlaceWhatsApp, navegacion, secciones, sitio } from "@/lib/sitio";

const enlace = "underline-offset-4 hover:underline";

export function Footer() {
  return (
    <footer className="on-dark bg-verde py-12 text-small text-crema md:py-16">
      <Container className="grid gap-8 md:grid-cols-3">
        <div>
          {/* TODO(marca): reemplazar por el logo negativo de public/brand/ (mínimo 140 px). */}
          <p className="font-serif text-h2">LAUBURU</p>
          <p className="mt-2 text-overline font-medium text-miel">{sitio.descriptiva}</p>
        </div>

        <div>
          <h2 className="text-overline font-medium text-miel">CONTACTO</h2>
          <ul className="mt-4 space-y-2">
            <li>{sitio.direccion}</li>
            <li>
              <a
                href={enlaceWhatsApp()}
                className={enlace}
                target="_blank"
                rel="noopener noreferrer"
              >
                WhatsApp
              </a>
            </li>
            <li>
              <a
                href={sitio.instagram}
                className={enlace}
                target="_blank"
                rel="noopener noreferrer"
              >
                Instagram
              </a>
            </li>
            <li>
              <a href={`mailto:${sitio.correo}`} className={enlace}>
                {sitio.correo}
              </a>
            </li>
          </ul>
        </div>

        <div>
          <h2 className="text-overline font-medium text-miel">EXPLORA</h2>
          <ul className="mt-4 space-y-2">
            {[...navegacion.slice(1), ...secciones].map(({ href, texto }) => (
              <li key={href}>
                <Link href={href} className={enlace}>
                  {texto}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </Container>

      <Container className="mt-8">
        <p className="border-t border-verde-hoja pt-6 opacity-85">
          RNT {sitio.rnt} · © {new Date().getFullYear()} {sitio.nombre}
        </p>
      </Container>
    </footer>
  );
}
