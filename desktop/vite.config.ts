import { copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const HERE = resolve(import.meta.dirname);
const DASHBOARD = resolve(HERE, "..", "dashboard");

// Desktop Vite config — builds the dashboard frontend into desktop/dist/
export default defineConfig({
  root: DASHBOARD,
  base: "./",
  plugins: [
    react(),
    {
      name: "dev-html-rewrite",
      transformIndexHtml(html: string) {
        return html
          .replace('/assets/app.js?token=__REASONIX_TOKEN__', '/src/main.tsx')
          .replace('/assets/app.css?token=__REASONIX_TOKEN__', '/src/styles.css');
      },
    },
    // Rollup input override skips HTML generation; copy the Tauri-specific
    // index.html (which references flat ./app.js / ./app.css) post-build.
    {
      name: "copy-index-html",
      closeBundle() {
        const src = resolve(HERE, "index.html");
        const dst = resolve(HERE, "dist", "index.html");
        if (!existsSync(src)) {
          console.warn("[copy-index-html] source not found:", src);
          return;
        }
        copyFileSync(src, dst);
        console.log(`[copy-index-html] ${src} → ${dst}`);
      },
    },
  ],
  build: {
    outDir: resolve(HERE, "dist"),
    emptyOutDir: true,
    target: "es2022",
    minify: "esbuild",
    sourcemap: true,
    rollupOptions: {
      input: {
        app: resolve(DASHBOARD, "src/main.tsx"),
      },
      output: {
        entryFileNames: "app.js",
        chunkFileNames: "[name].js",
        assetFileNames: (assetInfo) => {
          if (assetInfo.name === "app.css" || assetInfo.name === "index.css") return "app.css";
          if (/\.(woff2?|ttf|otf)$/.test(assetInfo.name ?? "")) return "assets/[name].[ext]";
          return "[name].[ext]";
        },
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("/katex/")) return "vendor-katex";
          if (
            id.includes("/react-markdown/") ||
            id.includes("/remark-") ||
            id.includes("/rehype-") ||
            id.includes("/mdast-") ||
            id.includes("/micromark") ||
            id.includes("/unist-") ||
            id.includes("/hast-")
          )
            return "vendor-markdown";
          if (id.includes("/prism-react-renderer/")) return "vendor-prism";
          if (id.includes("/lucide-react/")) return "vendor-icons";
          if (id.includes("/react-virtuoso/")) return "vendor-virtuoso";
          if (id.includes("/react/") || id.includes("/react-dom/") || id.includes("/scheduler/"))
            return "vendor-react";
        },
      },
    },
  },
  resolve: {
    alias: {
      "@reasonix/core-utils/compaction": resolve(DASHBOARD, "../packages/core-utils/src/compaction.ts"),
      "@reasonix/core-utils/derive-prefix": resolve(DASHBOARD, "../packages/core-utils/src/derive-prefix.ts"),
      "@reasonix/core-utils": resolve(DASHBOARD, "../packages/core-utils/src/index.ts"),
      "@tauri-apps/api/core": resolve(DASHBOARD, "src/lib/tauri-bridge.ts"),
      "@tauri-apps/api/event": resolve(DASHBOARD, "src/lib/tauri-bridge.ts"),
      "@tauri-apps/api/window": resolve(DASHBOARD, "src/lib/tauri-bridge.ts"),
      "@tauri-apps/api/webview": resolve(DASHBOARD, "src/lib/tauri-bridge.ts"),
      "@tauri-apps/plugin-dialog": resolve(DASHBOARD, "src/lib/tauri-bridge.ts"),
      "@tauri-apps/plugin-opener": resolve(DASHBOARD, "src/lib/tauri-bridge.ts"),
      "@tauri-apps/plugin-process": resolve(DASHBOARD, "src/lib/tauri-bridge.ts"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
  },
  clearScreen: false,
  envPrefix: ["VITE_", "TAURI_"],
});
