import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath } from "node:url";
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: [
      {
        find: "@tauri-apps/api/core",
        replacement: fileURLToPath(new URL("./fixture.ts", import.meta.url)),
      },
    ],
  },
  server: { host: "127.0.0.1", port: 1435, strictPort: true },
  optimizeDeps: { entries: ["qa/ai-report-live/index.html"] },
});
