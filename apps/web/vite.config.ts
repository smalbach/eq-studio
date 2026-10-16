import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

/**
 * A static SPA. In development Vite proxies `/v1` and `/health` to the API (`EQ_API_URL`,
 * default the local API on :4400); in production the API serves the built files itself, so the
 * app and the API share one origin and no CORS is involved.
 */
const api = process.env.EQ_API_URL ?? "http://127.0.0.1:4400";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)), "@examples": fileURLToPath(new URL("../../examples", import.meta.url)) } },
  server: { port: 3000, proxy: { "/v1": { target: api, changeOrigin: true }, "/health": { target: api, changeOrigin: true } } },
  build: { outDir: "dist", emptyOutDir: true, sourcemap: true },
});
