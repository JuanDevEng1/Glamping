import { defineConfig } from "drizzle-kit";

// Un solo archivo de entorno para todo el repo: el que lee Next.js en frontend/.
try {
  process.loadEnvFile("../frontend/.env.local");
} catch {
  // En Vercel/CI las variables ya vienen del entorno.
}

export default defineConfig({
  schema: "./src/db.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  casing: "snake_case",
});
