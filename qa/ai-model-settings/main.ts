import { createApp, h } from "vue";
import ModelSettings from "../../src/ai/ModelSettings.vue";
import type { ModelClient } from "../../src/ai/client";
import type { ModelConfig, ModelDefaults } from "../../src/ai/types";
import "../../src/terminal-base.css";
import "../../src/controls.css";
let models: ModelConfig[] = [
  {
    id: "flash",
    displayName: "MiMo 快速分析",
    provider: "xiaomi-mimo",
    baseUrl: "https://api.xiaomimimo.com/v1",
    model: "mimo-v2.6-flash",
    enabled: true,
  },
  {
    id: "pro",
    displayName: "MiMo 综合判断",
    provider: "xiaomi-mimo",
    baseUrl: "https://api.xiaomimimo.com/v1",
    model: "mimo-v2.6-pro",
    enabled: true,
  },
  {
    id: "deepseek",
    displayName: "DeepSeek 备用",
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-flash",
    enabled: false,
  },
];
let defaults: ModelDefaults = {
  participantIds: ["flash"],
  summaryModelId: "pro",
};
const calls: string[] = [];
Object.assign(window, { __modelSettingsCalls: calls });
const client: ModelClient = {
  desktop: true,
  listModels: async () => structuredClone(models),
  getDefaults: async () => structuredClone(defaults),
  saveModel: async (input) => {
    calls.push("saveModel");
    const saved = { ...input, id: input.id ?? `model-${models.length + 1}` };
    models = [...models.filter((m) => m.id !== saved.id), saved];
    return saved;
  },
  deleteModel: async (id) => {
    calls.push("deleteModel");
    models = models.filter((m) => m.id !== id);
    defaults.participantIds = defaults.participantIds.filter((i) => i !== id);
    if (defaults.summaryModelId === id) defaults.summaryModelId = null;
  },
  saveDefaults: async (value) => {
    calls.push("saveDefaults");
    defaults = structuredClone(value);
  },
  listModelVersions: async () => {
    calls.push("listModelVersions");
    return ["mimo-v2.6-flash", "mimo-v2.6-pro"];
  },
  testModel: async (id) => {
    calls.push("testModel");
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (new URLSearchParams(location.search).has("error"))
      throw { message: "密钥无效，请检查服务商和 API Key 是否对应。" };
    return { modelId: id, attempts: 1, usage: null };
  },
};
createApp({ render: () => h(ModelSettings, { client }) }).mount("#app");
const style = document.createElement("style");
style.textContent =
  "#app{max-width:1080px;padding:28px;margin:0 auto;}@media(max-width:600px){#app{padding:18px 12px}}";
document.head.append(style);
