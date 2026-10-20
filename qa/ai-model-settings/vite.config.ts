import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
export default defineConfig({
  plugins: [vue()],
  server: { host: "127.0.0.1", port: 1435, strictPort: true },
  optimizeDeps: { entries: ["qa/ai-model-settings/index.html"] },
});
