import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  build: {
    // Single entry point - pre-rendered SVG viewer (no D2 compilation)
    lib: {
      entry: "src/embed-viewer.tsx",
      name: "D2Viewer",
      fileName: () => "d2-viewer.js",
      formats: ["iife"],
    },
    // Output to dist folder
    outDir: "dist",
    // Inline everything - no code splitting
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        manualChunks: undefined,
      },
    },
    // Minify for production
    minify: "esbuild",
    // No source maps for smaller bundle
    sourcemap: false,
    // Clear output directory
    emptyOutDir: true,
  },
});
