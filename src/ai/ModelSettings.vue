<script setup lang="ts">
import {
  computed,
  nextTick,
  onMounted,
  onBeforeUnmount,
  reactive,
  ref,
  watch,
} from "vue";
import { modelClient, aiErrorMessage, type ModelClient } from "./client";
import type { ModelConfig, ModelConfigInput, ModelDefaults } from "./types";
import "./ai.css";
const props = defineProps<{ client?: ModelClient }>();
const emit = defineEmits<{ saved: [] }>();
const client = props.client ?? modelClient;
const models = ref<ModelConfig[]>([]),
  defaults = reactive<ModelDefaults>({
    participantIds: [],
    summaryModelId: null,
  });
const busy = ref(false),
  error = ref(""),
  notice = ref(""),
  editing = ref(false),
  secret = ref(""),
  confirmDelete = ref("");
const operation = ref("");
const editor = ref<HTMLElement | null>(null);
const editorError = ref("");
const editorNotice = ref("");
const discardPending = ref(false);
const editorBaseline = ref("");
const defaultsBaseline = ref("");
const testResults = reactive<
  Record<string, { state: "pending" | "success" | "error"; message: string }>
>({});
const providerNames: Record<string, string> = {
  custom: "自定义接口",
  openai: "OpenAI",
  "xiaomi-mimo": "小米 MiMo",
  deepseek: "DeepSeek",
};
const providerName = (provider: string) => providerNames[provider] ?? provider;
const defaultsKey = () =>
  JSON.stringify({
    participantIds: [...defaults.participantIds].sort(),
    summaryModelId: defaults.summaryModelId,
  });
const savedDefaults = computed<ModelDefaults>(() =>
  defaultsBaseline.value
    ? JSON.parse(defaultsBaseline.value)
    : { participantIds: [], summaryModelId: null },
);
const defaultsDirty = computed(
  () => !!defaultsBaseline.value && defaultsKey() !== defaultsBaseline.value,
);
const editorDirty = computed(
  () => JSON.stringify(form) !== editorBaseline.value || !!secret.value,
);
let returnFocus: HTMLElement | null = null;
const blank = (): ModelConfigInput => ({
  id: null,
  displayName: "",
  provider: "custom",
  baseUrl: "",
  model: "",
  enabled: true,
});
const form = reactive<ModelConfigInput>(blank());
const remoteVersions = ref<string[]>([]);
watch([() => form.baseUrl, () => form.provider], () => {
  remoteVersions.value = [];
});
const isMimo = computed(
  () =>
    form.provider === "xiaomi-mimo" ||
    /^https:\/\/(api|token-plan-cn)\.xiaomimimo\.com(?:\/|$)/.test(
      form.baseUrl,
    ),
);
const isDeepSeek = computed(
  () =>
    form.provider === "deepseek" ||
    /^https:\/\/api\.deepseek\.com(?:\/|$)/i.test(form.baseUrl),
);
const versions = computed(() => [
  ...new Set([
    ...remoteVersions.value,
    ...(isDeepSeek.value ? ["deepseek-flash", "deepseek-v4-pro"] : []),
    ...(isMimo.value
      ? [
          "mimo-v2.6-flash",
          "mimo-v2.6-pro",
          "mimo-v2.6-pro-ultraspeed",
          "mimo-v2.5-pro",
          "mimo-v2.5",
        ]
      : []),
  ]),
]);
const selectedVersion = computed({
  get: () => (versions.value.includes(form.model) ? form.model : ""),
  set: (value: string) => {
    form.model = value;
  },
});
const canFetchVersions = computed(
  () =>
    models.value.some(
      (m) =>
        m.id === form.id &&
        m.baseUrl === form.baseUrl &&
        m.provider === form.provider,
    ) && !secret.value,
);
async function fetchVersions() {
  if (!form.id || !canFetchVersions.value) return;
  await run(async () => {
    remoteVersions.value = await client.listModelVersions(form.id!);
    editorNotice.value = remoteVersions.value.length
      ? `已获取 ${remoteVersions.value.length} 个模型版本，请选择适合文本分析的版本`
      : "接口未返回模型版本，可手动填写模型标识";
  }, "versions");
}
const enabledModels = computed(() => models.value.filter((m) => m.enabled));
let mounted = true;
async function refresh() {
  const [m, d] = await Promise.all([client.listModels(), client.getDefaults()]);
  if (!mounted) return;
  const keepDraft = defaultsDirty.value;
  models.value = m;
  if (keepDraft) {
    const enabled = new Set(
      m.filter((model) => model.enabled).map((model) => model.id),
    );
    defaults.participantIds = defaults.participantIds.filter((id) =>
      enabled.has(id),
    );
    if (defaults.summaryModelId && !enabled.has(defaults.summaryModelId))
      defaults.summaryModelId = null;
  } else {
    defaults.participantIds = [...d.participantIds];
    defaults.summaryModelId = d.summaryModelId;
  }
  defaultsBaseline.value = JSON.stringify({
    participantIds: [...d.participantIds].sort(),
    summaryModelId: d.summaryModelId,
  });
}
async function run(action: () => Promise<void>, kind = "load") {
  if (busy.value || !client.desktop) return;
  busy.value = true;
  operation.value = kind;
  editorError.value = "";
  editorNotice.value = "";
  error.value = "";
  notice.value = "";
  try {
    await action();
  } catch (e) {
    if (mounted) {
      if (["save", "versions"].includes(kind))
        editorError.value = aiErrorMessage(e);
      else error.value = aiErrorMessage(e);
    }
  } finally {
    if (mounted) {
      busy.value = false;
      operation.value = "";
    }
  }
}
async function edit(model?: ModelConfig) {
  returnFocus =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  remoteVersions.value = [];
  Object.assign(form, model ?? blank());
  secret.value = "";
  editorBaseline.value = JSON.stringify(form);
  discardPending.value = false;
  editorError.value = "";
  editorNotice.value = "";
  editing.value = true;
  await nextTick();
  editor.value?.querySelector<HTMLSelectElement>("select")?.focus();
  error.value = "";
  notice.value = "";
}
function closeEditor(discard = false) {
  if (busy.value) return;
  if (editorDirty.value && !discard) {
    discardPending.value = true;
    void nextTick(() =>
      editor.value
        ?.querySelector<HTMLButtonElement>('[data-action="continue-editor"]')
        ?.focus(),
    );
    return;
  }
  editing.value = false;
  secret.value = "";
  discardPending.value = false;
  void nextTick(() => returnFocus?.isConnected && returnFocus.focus());
}
function continueEditing() {
  discardPending.value = false;
  void nextTick(() =>
    editor.value?.querySelector<HTMLSelectElement>("select")?.focus(),
  );
}
function editorKeys(event: KeyboardEvent) {
  if (!editing.value || !editor.value?.isConnected) return;
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeEditor();
  }
  if (event.key !== "Tab") return;
  const elements = [
    ...(editor.value?.querySelectorAll<HTMLElement>(
      "button:not(:disabled), input:not(:disabled), select:not(:disabled), summary",
    ) ?? []),
  ].filter((el) => el.getClientRects().length > 0);
  const first = elements[0],
    last = elements.at(-1);
  if (!editor.value.contains(document.activeElement)) {
    event.preventDefault();
    (event.shiftKey ? last : first)?.focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}
function providerChanged() {
  remoteVersions.value = [];
  if (form.provider === "deepseek") form.baseUrl = "https://api.deepseek.com";
  if (form.provider === "openai") form.baseUrl = "https://api.openai.com/v1";
  if (
    form.provider === "xiaomi-mimo" &&
    !/^https:\/\/(api|token-plan-cn)\.xiaomimimo\.com(?:\/|$)/.test(
      form.baseUrl,
    )
  ) {
    form.baseUrl = "https://api.xiaomimimo.com/v1";
  }
}
async function save() {
  await run(async () => {
    if (!form.id && form.enabled && !secret.value.trim()) {
      editorError.value = "请输入 API Key 后再启用这个模型。";
      return;
    }
    if (
      isMimo.value &&
      /^(mimo[-_ ]?)?token[-_ ]?plan$/i.test(form.model.trim())
    ) {
      editorError.value =
        "Token Plan 是套餐名称，请选择具体模型版本，例如 mimo-v2.6-pro";
      return;
    }
    const saved = await client.saveModel(
      { ...form },
      secret.value.trim() || null,
    );
    secret.value = "";
    await refresh();
    if (!mounted) return;
    Object.assign(form, saved);
    editorBaseline.value = JSON.stringify(form);
    discardPending.value = false;
    editorNotice.value = "模型已保存";
    delete testResults[saved.id];
    emit("saved");
  }, "save");
}
async function saveDefaults() {
  await run(async () => {
    await client.saveDefaults({
      participantIds: [...defaults.participantIds],
      summaryModelId: defaults.summaryModelId || null,
    });
    defaultsBaseline.value = defaultsKey();
    notice.value = "默认模型已保存";
    emit("saved");
  }, "defaults");
}
async function test(model: ModelConfig) {
  await run(async () => {
    testResults[model.id] = { state: "pending", message: "正在测试连接…" };
    try {
      const result = await client.testModel(model.id);
      if (mounted)
        testResults[model.id] = {
          state: "success",
          message: `连接成功 · 实际调用 ${result.attempts} 次`,
        };
    } catch (e) {
      if (mounted)
        testResults[model.id] = { state: "error", message: aiErrorMessage(e) };
    }
  }, "test");
}
async function remove(model: ModelConfig) {
  await run(async () => {
    try {
      await client.deleteModel(model.id);
    } finally {
      await refresh();
      confirmDelete.value = "";
      delete testResults[model.id];
      if (form.id && !models.value.some((model) => model.id === form.id)) {
        editing.value = false;
        secret.value = "";
      }
    }
    notice.value = "模型配置已删除，历史报告保留";
    emit("saved");
  });
}
onMounted(() => {
  document.addEventListener("keydown", editorKeys, true);
  if (client.desktop) void run(refresh);
});
onBeforeUnmount(() => {
  document.removeEventListener("keydown", editorKeys, true);
  mounted = false;
  secret.value = "";
});
</script>
<template>
  <section class="ai-settings" aria-label="AI 模型设置">
    <div class="ai-settings-main" :inert="editing || undefined">
      <header class="ai-settings-heading">
        <div>
          <h2>AI 模型</h2>
          <p>管理模型连接，选择谁来分析、谁来汇总。</p>
        </div>
        <button
          class="primary"
          aria-label="新增模型"
          :disabled="busy || !client.desktop"
          @click="edit()"
        >
          <span aria-hidden="true">＋</span> 添加模型
        </button>
      </header>
      <p v-if="!client.desktop" class="ai-preview-note">
        浏览器预览仅展示界面；请在桌面应用中配置并保存真实密钥。
      </p>
      <p v-if="error" role="alert" class="ai-message ai-error">{{ error }}</p>
      <p v-if="notice" role="status" class="ai-message ai-settings-success">
        {{ notice }}
      </p>
      <section
        class="ai-settings-card ai-model-library"
        aria-label="已添加的模型"
        :aria-busy="operation === 'load'"
      >
        <header class="ai-card-heading">
          <h3>
            已添加的模型 <span class="ai-count">{{ models.length }}</span>
          </h3>
          <span class="ai-quiet">{{ enabledModels.length }} 个已启用</span>
        </header>
        <div v-if="!models.length" class="ai-model-empty">
          <strong>{{ busy ? "正在读取模型…" : "添加第一个模型" }}</strong>
          <p v-if="!busy">
            准备好服务商提供的 API 地址、密钥和模型名称，即可开始配置。
          </p>
          <button v-if="!busy" :disabled="!client.desktop" @click="edit()">
            添加模型
          </button>
        </div>
        <article
          v-for="model in models"
          :key="model.id"
          class="ai-model-row"
          :class="{ 'is-disabled': !model.enabled }"
        >
          <div class="ai-model-identity">
            <div class="ai-model-name">
              <strong>{{ model.displayName }}</strong
              ><span
                class="ai-model-state"
                :class="{ enabled: model.enabled }"
                >{{ model.enabled ? "已启用" : "已停用" }}</span
              >
            </div>
            <small class="ai-model-description"
              >{{ providerName(model.provider) }}
              <span aria-hidden="true">·</span>
              <code>{{ model.model }}</code></small
            >
            <small class="ai-address" :title="model.baseUrl">{{
              model.baseUrl
            }}</small>
            <p
              v-if="testResults[model.id]"
              class="ai-model-test-result"
              :class="testResults[model.id]!.state"
              :role="
                testResults[model.id]!.state === 'error' ? 'alert' : 'status'
              "
            >
              {{ testResults[model.id]!.message }}
            </p>
          </div>
          <div class="ai-model-roles" aria-label="已保存的默认用途">
            <span v-if="savedDefaults.participantIds.includes(model.id)"
              >独立分析</span
            ><span v-if="savedDefaults.summaryModelId === model.id"
              >综合汇总</span
            >
          </div>
          <div class="ai-model-actions">
            <button
              :aria-label="'编辑' + model.displayName"
              :disabled="busy"
              @click="edit(model)"
            >
              编辑
            </button>
            <button
              :aria-label="'测试' + model.displayName + '连接'"
              :disabled="busy || !model.enabled"
              @click="test(model)"
            >
              {{
                testResults[model.id]?.state === "pending"
                  ? "正在测试…"
                  : "测试连接"
              }}
            </button>
            <button
              class="ai-model-delete"
              :aria-label="'删除' + model.displayName"
              :disabled="busy"
              @click="
                confirmDelete = confirmDelete === model.id ? '' : model.id
              "
            >
              删除
            </button>
          </div>
          <div v-if="confirmDelete === model.id" class="ai-delete-confirm">
            <span>删除“{{ model.displayName }}”？历史报告会保留。</span
            ><button
              class="ai-danger-button"
              :disabled="busy"
              @click="remove(model)"
            >
              确认删除</button
            ><button :disabled="busy" @click="confirmDelete = ''">取消</button>
          </div>
        </article>
        <footer class="ai-library-footnote">
          测试连接会发送一条简短请求，可能产生调用费用；网络失败时可能重试。保存配置不会自动测试。
        </footer>
      </section>
      <section class="ai-settings-card ai-defaults">
        <header class="ai-card-heading">
          <div>
            <h3>默认分析安排</h3>
            <p>开始分析时自动选中，单次分析仍可调整。</p>
          </div>
          <span class="ai-default-state" :class="{ dirty: defaultsDirty }">{{
            defaultsDirty ? "有更改未保存" : "已保存"
          }}</span>
        </header>
        <div class="ai-default-columns">
          <div class="ai-default-field">
            <h4>独立分析 <span>可多选</span></h4>
            <p>各模型分别给出自己的判断。</p>
            <div class="ai-default-list">
              <label
                v-for="model in enabledModels"
                :key="model.id"
                class="ai-default-option"
                :class="{
                  selected: defaults.participantIds.includes(model.id),
                }"
                ><input
                  v-model="defaults.participantIds"
                  type="checkbox"
                  :value="model.id"
                  :disabled="busy || !client.desktop"
                /><span>{{ model.displayName }}</span></label
              ><small v-if="!enabledModels.length"
                >添加并启用模型后，即可选择。</small
              >
            </div>
          </div>
          <div class="ai-default-field">
            <label class="ai-default-summary-label" for="ai-default-summary"
              >综合汇总 <span>单选</span></label
            >
            <p>对照独立报告，生成最终操作结论。</p>
            <select
              id="ai-default-summary"
              v-model="defaults.summaryModelId"
              aria-label="默认汇总模型"
              :disabled="busy || !client.desktop || !enabledModels.length"
            >
              <option :value="null">请选择汇总模型</option>
              <option
                v-for="model in enabledModels"
                :key="model.id"
                :value="model.id"
              >
                {{ model.displayName }}
              </option></select
            ><small>可以与独立分析使用同一个模型，仍会额外生成综合结论。</small>
          </div>
        </div>
        <footer class="ai-default-footer">
          <span
            >{{ defaults.participantIds.length }} 个独立分析模型 ·
            {{
              enabledModels.find((m) => m.id === defaults.summaryModelId)
                ?.displayName || "尚未选择汇总模型"
            }}</span
          ><button
            aria-label="保存默认模型"
            :disabled="busy || !client.desktop || !enabledModels.length"
            @click="saveDefaults"
          >
            {{ operation === "defaults" ? "正在保存…" : "保存默认模型" }}
          </button>
        </footer>
      </section>
    </div>
    <Transition name="ai-model-editor">
      <div v-if="editing" class="ai-model-overlay" @click.self="closeEditor()">
        <section
          ref="editor"
          class="ai-model-editor-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ai-model-editor-title"
        >
          <header class="ai-editor-heading">
            <div>
              <h3 id="ai-model-editor-title">
                {{ form.id ? "编辑模型" : "添加模型" }}
              </h3>
              <p>
                {{
                  form.id
                    ? "修改连接信息或更换模型版本。"
                    : "连接服务商，添加用于股票分析的模型。"
                }}
              </p>
            </div>
            <button
              type="button"
              aria-label="关闭模型编辑"
              :disabled="busy"
              @click="closeEditor()"
            >
              ×
            </button>
          </header>
          <form class="ai-model-form" @submit.prevent="save">
            <div class="ai-editor-body">
              <section class="ai-editor-section">
                <h4>模型服务</h4>
                <label
                  >服务商<select
                    v-model="form.provider"
                    aria-label="服务商"
                    :disabled="busy"
                    @change="providerChanged"
                  >
                    <option value="custom">自定义 / OpenAI 兼容接口</option>
                    <option value="openai">OpenAI</option>
                    <option value="xiaomi-mimo">小米 MiMo</option>
                    <option value="deepseek">DeepSeek</option>
                  </select></label
                >
                <label
                  >API 基础地址<input
                    v-model="form.baseUrl"
                    aria-label="API 基础地址"
                    type="url"
                    required
                    maxlength="2048"
                    :disabled="busy"
                    placeholder="https://example.com/v1"
                    autocomplete="url"
                    spellcheck="false"
                /></label>
                <small
                  >填写服务商的基础地址，无需添加 /chat/completions。</small
                >
                <details v-if="isMimo" class="ai-provider-address-help">
                  <summary>MiMo 套餐与按量付费地址</summary>
                  <p>
                    Token Plan
                    是套餐名称，不是模型版本。套餐地址：token-plan-cn.xiaomimimo.com/v1；按量付费：api.xiaomimimo.com/v1。请选择与密钥对应的地址。
                  </p>
                </details>
                <label
                  >API Key <span v-if="form.id">留空保留原密钥</span
                  ><input
                    v-model="secret"
                    aria-label="API Key"
                    type="password"
                    autocomplete="new-password"
                    spellcheck="false"
                    maxlength="8192"
                    :disabled="busy"
                    :placeholder="
                      form.id ? '留空保留已有密钥' : '粘贴服务商提供的 API Key'
                    "
                /></label>
                <small>更换接口主机后，需要填写该服务对应的密钥。</small>
              </section>
              <section class="ai-editor-section">
                <div class="ai-field-heading">
                  <h4>选择模型</h4>
                  <button
                    type="button"
                    aria-label="获取模型版本"
                    :disabled="busy || !canFetchVersions || !client.desktop"
                    @click="fetchVersions"
                  >
                    {{
                      operation === "versions" ? "正在获取…" : "获取模型版本"
                    }}
                  </button>
                </div>
                <label
                  >模型标识<input
                    v-model="form.model"
                    aria-label="模型标识"
                    required
                    maxlength="256"
                    :disabled="busy"
                    placeholder="填写服务商提供的模型 ID"
                    spellcheck="false"
                /></label>
                <label v-if="versions.length"
                  >快速选择版本<select
                    v-model="selectedVersion"
                    aria-label="模型版本"
                    :disabled="busy"
                  >
                    <option value="">自定义模型标识</option>
                    <option
                      v-for="version in versions"
                      :key="version"
                      :value="version"
                    >
                      {{ version }}
                    </option>
                  </select></label
                >
                <small>{{
                  canFetchVersions
                    ? "可读取服务商模型列表，不发起文本生成；具体权限以你的套餐为准。"
                    : "先保存地址与密钥，再获取模型列表；也可直接填写模型标识。"
                }}</small>
                <p v-if="isDeepSeek || isMimo" class="ai-provider-tip">
                  已要求服务商关闭思考，直接输出分析结果；实际响应速度仍受网络和服务端影响。
                </p>
              </section>
              <section class="ai-editor-section">
                <h4>显示与状态</h4>
                <label
                  >显示名称<input
                    v-model="form.displayName"
                    aria-label="显示名称"
                    required
                    maxlength="80"
                    :disabled="busy"
                    placeholder="例如：MiMo 快速分析" /></label
                ><small>仅用于本应用，方便区分不同模型。</small
                ><label class="ai-editor-enabled"
                  ><span
                    ><strong>启用模型</strong
                    ><small>启用后可参与分析和汇总。</small></span
                  ><input
                    v-model="form.enabled"
                    type="checkbox"
                    :disabled="busy"
                /></label>
              </section>
              <details class="ai-connection-help">
                <summary>密钥存储与接口说明</summary>
                <p>
                  密钥保存在本机 SQLite
                  数据库；复制数据库也会复制密钥。分析报告和账本 JSON
                  导出不包含密钥。
                </p>
                <p>
                  应用自动追加 /chat/completions；本机服务可以使用
                  HTTP。模型标识须与服务商要求一致，区分大小写。
                </p>
              </details>
            </div>
            <footer class="ai-editor-footer">
              <p v-if="editorError" role="alert" class="ai-message ai-error">
                {{ editorError }}
              </p>
              <p
                v-if="editorNotice"
                role="status"
                class="ai-message ai-settings-success"
              >
                {{ editorNotice }}
              </p>
              <div
                v-if="discardPending"
                class="ai-editor-discard"
                role="status"
              >
                <strong>修改尚未保存，确定放弃吗？</strong>
                <div>
                  <button
                    type="button"
                    data-action="continue-editor"
                    @click="continueEditing()"
                  >
                    继续编辑</button
                  ><button
                    type="button"
                    data-action="discard-editor"
                    class="ai-danger-button"
                    @click="closeEditor(true)"
                  >
                    放弃修改
                  </button>
                </div>
              </div>
              <div v-else class="ai-editor-actions">
                <span>{{
                  editorDirty
                    ? "有更改未保存"
                    : form.id
                      ? "配置已保存"
                      : "仅保存配置，不会调用模型"
                }}</span
                ><button type="button" :disabled="busy" @click="closeEditor()">
                  {{ form.id && !editorDirty ? "完成" : "取消" }}</button
                ><button
                  class="primary"
                  type="submit"
                  :disabled="busy || !client.desktop"
                >
                  {{ operation === "save" ? "正在保存…" : "保存模型" }}
                </button>
              </div>
            </footer>
          </form>
        </section>
      </div>
    </Transition>
  </section>
</template>
<style scoped src="./model-settings.css"></style>
