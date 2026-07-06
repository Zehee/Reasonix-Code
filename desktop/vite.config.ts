import { resolve } from "node:path";
import { defineConfig } from "vite";

const HERE = resolve(import.meta.dirname);

// Vite builds the dashboard/ frontend, output goes to desktop/dist/
export default defineConfig({
  root: resolve(HERE, "..", "dashboard"),
  base: "./",
  build: {
    outDir: resolve(HERE, "dist"),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@reasonix/core-utils": resolve(HERE, "..", "packages", "core-utils", "src"),
    },
  },
  server: {
    port: 1420,
    strictPort: true,
  },
  // Tauri expects a fixed port in production
  clearScreen: false,
  envPrefix: ["VITE_", "TAURI_"],
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? "0.1.0"),
  },
});
