import { defineConfig, globalIgnores } from "eslint/config";
import eslint from "@eslint/js";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const eslintConfig = defineConfig([
  globalIgnores([
    ".next/**",
    "**/dist/**",
    "out/**",
    "build/**",
  ]),
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  react.configs.flat.recommended,
  react.configs.flat["jsx-runtime"],
  reactHooks.configs.flat["recommended-latest"],
  jsxA11y.flatConfigs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.serviceworker,
      },
    },
    settings: {
      react: {
        version: "19.2",
      },
    },
  },
  {
    // The API's domain layer is plain TypeScript: no framework, no ORM. Handlers depend on it;
    // it depends on nothing that would tie it to how it is served or stored.
    files: ["apps/api/src/modules/*/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ group: ["@nestjs/*", "typeorm", "pg", "sql.js", "express"], message: "The domain layer imports no framework, ORM or driver." }] }],
    },
  },
  {
    // Controllers validate, resolve the workspace and dispatch to a bus. They never reach a
    // repository or the database directly.
    files: ["apps/api/src/modules/*/presentation/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ group: ["**/infrastructure/**", "typeorm"], message: "Controllers dispatch commands and queries; they do not touch persistence." }] }],
    },
  },
]);

export default eslintConfig;
