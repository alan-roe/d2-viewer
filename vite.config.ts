import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { d2WatchPlugin } from "./src/vite-plugin-d2";

// D2_DIR environment variable sets the watch directory
// Usage: D2_DIR=/path/to/diagrams bun dev
const watchDir = process.env.D2_DIR;

export default defineConfig({
  plugins: [solid(), d2WatchPlugin({ watchDir })],
  optimizeDeps: {
    exclude: ["@terrastruct/d2"],
  },
});
