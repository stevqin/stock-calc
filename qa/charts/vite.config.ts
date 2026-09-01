import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath } from "node:url";
const fixture = fileURLToPath(new URL("./fixture.ts", import.meta.url));
export default defineConfig({
  optimizeDeps: { entries: ["qa/charts/index.html"] },
  plugins: [vue()],
  resolve: {
    alias: [
      { find: "@tauri-apps/api/core", replacement: fixture },
      { find: "../market", replacement: fixture },
    ],
  },
  server: { host: "127.0.0.1", port: 1421, strictPort: true },
});
