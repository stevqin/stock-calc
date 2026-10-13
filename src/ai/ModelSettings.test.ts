import { mount, flushPromises } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import ModelSettings from "./ModelSettings.vue";
import type { ModelClient } from "./client";
import type { ModelConfig, ModelDefaults } from "./types";
function fixture() {
  let models: ModelConfig[] = [
    {
      id: "one",
      displayName: "模型一",
      provider: "custom",
      baseUrl: "https://one.example/v1",
      model: "model-one",
      enabled: true,
    },
  ];
  let defaults: ModelDefaults = {
    participantIds: ["one"],
    summaryModelId: "one",
  };
  const saves: { secret: string | null }[] = [];
  const client: ModelClient = {
    desktop: true,
    listModels: async () => models.map((m) => ({ ...m })),
    getDefaults: async () => ({
      ...defaults,
      participantIds: [...defaults.participantIds],
    }),
    saveDefaults: async (d) => {
      defaults = { ...d, participantIds: [...d.participantIds] };
    },
    saveModel: async (input, secret) => {
      saves.push({ secret });
      const saved = { ...input, id: input.id ?? "two" };
      models = [...models.filter((m) => m.id !== saved.id), saved];
      return saved;
    },
    deleteModel: async (id) => {
      models = models.filter((m) => m.id !== id);
    },
    listModelVersions: async () => [],
    testModel: async (id) => ({ modelId: id, attempts: 1, usage: null }),
  };
  return { client, saves };
}
describe("AI model settings", () => {
  it("selects MiMo model versions and preserves subscription address and existing key", async () => {
    const f = fixture();
    const w = mount(ModelSettings, { props: { client: f.client } });
    await flushPromises();
    await w.get('button[aria-label="编辑模型一"]').trigger("click");
    await w
      .get('input[aria-label="API 基础地址"]')
      .setValue("https://token-plan-cn.xiaomimimo.com/v1");
    await w.get('select[aria-label="服务商"]').setValue("xiaomi-mimo");
    expect(
      (w.get('input[aria-label="API 基础地址"]').element as HTMLInputElement)
        .value,
    ).toBe("https://token-plan-cn.xiaomimimo.com/v1");
    await w.get('select[aria-label="模型版本"]').setValue("mimo-v2.6-pro");
    await w.get("form").trigger("submit");
    await flushPromises();
    expect((await f.client.listModels())[0]?.model).toBe("mimo-v2.6-pro");
    expect(f.saves[0]?.secret).toBeNull();
    expect(w.text()).toContain("Token Plan 是套餐名称");
    w.unmount();
  });
  it("fetches versions for saved configuration, retains custom model input", async () => {
    const f = fixture();
    f.client.listModelVersions = async () => ["remote-pro", "remote-flash"];
    const w = mount(ModelSettings, { props: { client: f.client } });
    await flushPromises();
    await w.get('button[aria-label="编辑模型一"]').trigger("click");
    await w.get('button[aria-label="获取模型版本"]').trigger("click");
    await flushPromises();
    expect(w.get('select[aria-label="模型版本"]').text()).toContain(
      "remote-pro",
    );
    await w.get('select[aria-label="模型版本"]').setValue("remote-pro");
    await w.get("form").trigger("submit");
    await flushPromises();
    expect((await f.client.listModels())[0]?.model).toBe("remote-pro");
    await w.get('select[aria-label="模型版本"]').setValue("");
    await w.get('input[aria-label="模型标识"]').setValue("private-version");
    await w.get("form").trigger("submit");
    await flushPromises();
    expect((await f.client.listModels())[0]?.model).toBe("private-version");
    w.unmount();
  });
  it("rejects a MiMo subscription name and fetches only saved credentials", async () => {
    const f = fixture();
    const fetch = vi.fn(f.client.listModelVersions);
    f.client.listModelVersions = fetch;
    const w = mount(ModelSettings, { props: { client: f.client } });
    await flushPromises();
    await w.get('button[aria-label="编辑模型一"]').trigger("click");
    await w.get('select[aria-label="服务商"]').setValue("xiaomi-mimo");
    await w.get('input[aria-label="模型标识"]').setValue("MIMO-TokenPlan");
    await w.get("form").trigger("submit");
    await flushPromises();
    expect(w.get('[role="alert"]').text()).toContain("套餐名称");
    expect(f.saves).toHaveLength(0);
    expect(
      w.get('button[aria-label="获取模型版本"]').attributes("disabled"),
    ).toBeDefined();
    expect(fetch).not.toHaveBeenCalled();
    w.unmount();
  });
  it("creates custom configuration, masks and clears key after save", async () => {
    const f = fixture();
    const w = mount(ModelSettings, { props: { client: f.client } });
    await flushPromises();
    await w.get('button[aria-label="新增模型"]').trigger("click");
    await w.get('input[aria-label="显示名称"]').setValue("模型二");
    await w
      .get('input[aria-label="API 基础地址"]')
      .setValue("https://custom.example/v1");
    await w.get('input[aria-label="模型标识"]').setValue("custom-model");
    const key = w.get('input[aria-label="API Key"]');
    expect(key.attributes("type")).toBe("password");
    await key.setValue("test-key");
    await w.get("form").trigger("submit");
    await flushPromises();
    expect(w.text()).toContain("模型二");
    expect(w.text()).not.toContain("test-key");
    expect(
      (w.get('input[aria-label="API Key"]').element as HTMLInputElement).value,
    ).toBe("");
    expect(f.saves[0]?.secret).toBe("test-key");
    w.unmount();
  });
  it("edit keeps old key when blank and persists defaults separately", async () => {
    const f = fixture();
    const w = mount(ModelSettings, { props: { client: f.client } });
    await flushPromises();
    await w.get('button[aria-label="编辑模型一"]').trigger("click");
    await w.get('input[aria-label="显示名称"]').setValue("模型一改名");
    await w.get("form").trigger("submit");
    await flushPromises();
    expect(f.saves[0]?.secret).toBeNull();
    expect(w.text()).toContain("模型一改名");
    await w.get('select[aria-label="默认汇总模型"]').setValue("one");
    await w.get('button[aria-label="保存默认模型"]').trigger("click");
    await flushPromises();
    expect(w.text()).toContain("默认模型已保存");
    w.unmount();
  });
  it("connection test states possible cost and displays safe service errors", async () => {
    const f = fixture();
    f.client.testModel = async () => {
      throw {
        code: "authentication",
        message: "密钥或访问权限无效",
        retryable: false,
      };
    };
    const w = mount(ModelSettings, { props: { client: f.client } });
    await flushPromises();
    expect(w.text()).toContain("可能产生调用费用");
    await w.get('button[aria-label="测试模型一连接"]').trigger("click");
    await flushPromises();
    expect(w.get('[role="alert"]').text()).toContain("密钥或访问权限无效");
    w.unmount();
  });
  it("browser preview cannot save real credentials", async () => {
    const f = fixture();
    f.client.desktop = false;
    const list = vi.fn(f.client.listModels);
    f.client.listModels = list;
    const w = mount(ModelSettings, { props: { client: f.client } });
    await flushPromises();
    expect(w.text()).toContain("浏览器预览");
    expect(
      w.get('button[aria-label="新增模型"]').attributes("disabled"),
    ).toBeDefined();
    expect(list).not.toHaveBeenCalled();
    w.unmount();
  });

  it("clears editor when config deletion succeeds but credential cleanup fails", async () => {
    const f = fixture();
    const remove = f.client.deleteModel;
    f.client.deleteModel = async (id) => {
      await remove(id);
      throw {
        code: "cleanupPending",
        message: "配置已删除，旧凭证清理失败",
        retryable: false,
      };
    };
    const w = mount(ModelSettings, { props: { client: f.client } });
    await flushPromises();
    await w.get('button[aria-label="编辑模型一"]').trigger("click");
    await w
      .findAll("button")
      .find((b) => b.text() === "删除")!
      .trigger("click");
    await w
      .findAll("button")
      .find((b) => b.text() === "确认删除")!
      .trigger("click");
    await flushPromises();
    expect(w.find("form").exists()).toBe(false);
    expect(w.get('[role="alert"]').text()).toContain("配置已删除");
    w.unmount();
  });
});
