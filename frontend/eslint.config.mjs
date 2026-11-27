import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// eslint-config-next 16 ya exporta configuración plana (sin FlatCompat).
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Reglas nuevas de react-hooks 7 (llegaron con Next 16). El código existente las incumple
    // en 8 componentes; quedan como aviso hasta ajustarlos en una tarea aparte.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
    },
  },
  globalIgnores(["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);

export default eslintConfig;
