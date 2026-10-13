<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, reactive, ref } from "vue";
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
const blank = (): ModelConfigInput => ({
  id: null,
  displayName: "",
  provider: "custom",
  baseUrl: "",
  model: "",
  enabled: true,
});
const form = reactive<ModelConfigInput>(blank());
const enabledModels = computed(() => models.value.filter((m) => m.enabled));
let mounted = true;
async function refresh() {
  const [m, d] = await Promise.all([client.listModels(), client.getDefaults()]);
  if (!mounted) return;
  models.value = m;
  defaults.participantIds = [...d.participantIds];
  defaults.summaryModelId = d.summaryModelId;
}
async function run(action: () => Promise<void>) {
  if (busy.value || !client.desktop) return;
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    await action();
  } catch (e) {
    if (mounted) error.value = aiErrorMessage(e);
  } finally {
    if (mounted) busy.value = false;
  }
}
function edit(model?: ModelConfig) {
  Object.assign(form, model ?? blank());
  secret.value = "";
  editing.value = true;
  error.value = "";
  notice.value = "";
}
function providerChanged() {
  if (form.provider === "openai") form.baseUrl = "https://api.openai.com/v1";
}
async function save() {
  await run(async () => {
    if (!form.id && form.enabled && !secret.value.trim()) {
      error.value = "启用新模型需要输入密钥";
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
    notice.value = "模型已保存";
    emit("saved");
  });
}
async function saveDefaults() {
  await run(async () => {
    await client.saveDefaults({
      participantIds: [...defaults.participantIds],
      summaryModelId: defaults.summaryModelId || null,
    });
    notice.value = "默认模型已保存";
    emit("saved");
  });
}
async function test(model: ModelConfig) {
  await run(async () => {
    const result = await client.testModel(model.id);
    notice.value = `${model.displayName}连接成功 · 实际调用 ${result.attempts} 次`;
  });
}
async function remove(model: ModelConfig) {
  await run(async () => {
    try {
      await client.deleteModel(model.id);
    } finally {
      await refresh();
      confirmDelete.value = "";
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
  if (client.desktop) void run(refresh);
});
onBeforeUnmount(() => {
  mounted = false;
  secret.value = "";
});
</script>
<template>
  <section class="ai-settings" aria-label="AI 模型设置">
    <header class="ai-settings-heading">
      <div>
        <h2>AI 模型设置</h2>
        <p>
          独立配置各模型，选择默认参与模型与汇总模型。建议每次使用 2～3 个模型。
        </p>
      </div>
      <button
        aria-label="新增模型"
        :disabled="busy || !client.desktop"
        @click="edit()"
      >
        新增模型
      </button>
    </header>
    <p v-if="!client.desktop" class="ai-preview-note">
      浏览器预览仅展示界面；请在桌面应用中配置并保存真实密钥。
    </p>
    <p v-if="error" role="alert" class="ai-message ai-error">{{ error }}</p>
    <p v-if="notice" role="status" class="ai-message">{{ notice }}</p>
    <div class="ai-settings-grid">
      <section class="ai-settings-card">
        <h3>模型配置</h3>
        <p v-if="!models.length">
          {{
            busy
              ? "正在读取模型配置…"
              : "还没有模型配置。新增模型后可以测试连接。"
          }}
        </p>
        <article v-for="model in models" :key="model.id" class="ai-model-row">
          <div>
            <strong>{{ model.displayName }}</strong
            ><small
              >{{ model.model }} ·
              {{ model.enabled ? "已启用" : "已禁用" }}</small
            ><small class="ai-address">{{ model.baseUrl }}</small>
          </div>
          <div class="ai-model-actions">
            <button
              :aria-label="'编辑' + model.displayName"
              :disabled="busy"
              @click="edit(model)"
            >
              编辑</button
            ><button
              :aria-label="'测试' + model.displayName + '连接'"
              :disabled="busy || !model.enabled"
              @click="test(model)"
            >
              测试连接</button
            ><button :disabled="busy" @click="confirmDelete = model.id">
              删除
            </button>
          </div>
          <div v-if="confirmDelete === model.id" class="ai-delete-confirm">
            <span>删除此模型配置？历史报告仍保留。</span
            ><button :disabled="busy" @click="remove(model)">确认删除</button
            ><button :disabled="busy" @click="confirmDelete = ''">取消</button>
          </div>
        </article>
        <p class="ai-settings-hint">
          测试连接预计调用 1 次，失败重试可能增加次数，可能产生调用费用。
        </p>
      </section>
      <form
        v-if="editing"
        class="ai-settings-card ai-model-form"
        @submit.prevent="save"
      >
        <h3>{{ form.id ? "编辑模型" : "新增模型" }}</h3>
        <label
          >显示名称<input
            v-model="form.displayName"
            aria-label="显示名称"
            required
            maxlength="80"
            :disabled="busy"
            placeholder="例如：模型 A"
        /></label>
        <label
          >服务商<select
            v-model="form.provider"
            aria-label="服务商"
            :disabled="busy"
            @change="providerChanged"
          >
            <option value="custom">自定义 / OpenAI 兼容接口</option>
            <option value="openai">OpenAI</option>
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
            placeholder="https://example.com/v1" /></label
        ><small
          >填写基础地址，应用追加
          /chat/completions。更换主机时需重新输入对应密钥；本机服务可使用
          HTTP。</small
        >
        <label
          >模型标识<input
            v-model="form.model"
            aria-label="模型标识"
            required
            maxlength="256"
            :disabled="busy"
            placeholder="服务商提供的模型名称"
        /></label>
        <label
          >API Key<input
            v-model="secret"
            aria-label="API Key"
            type="password"
            autocomplete="new-password"
            spellcheck="false"
            maxlength="8192"
            :disabled="busy"
            :placeholder="
              form.id ? '留空保留已有密钥' : '输入模型服务密钥'
            " /></label
        ><small>密钥保存到系统安全存储，不写入账本或分析报告。</small>
        <label class="ai-check"
          ><input
            v-model="form.enabled"
            type="checkbox"
            :disabled="busy"
          />启用模型</label
        >
        <div class="ai-form-actions">
          <button
            class="primary"
            type="submit"
            :disabled="busy || !client.desktop"
          >
            {{ busy ? "正在处理…" : "保存模型" }}</button
          ><button
            type="button"
            :disabled="busy"
            @click="
              editing = false;
              secret = '';
            "
          >
            收起
          </button>
        </div>
      </form>
    </div>
    <section class="ai-settings-card ai-defaults">
      <h3>默认分析模型</h3>
      <p>勾选默认参与独立分析的模型；汇总模型可以同时参与独立分析。</p>
      <div class="ai-default-list">
        <label v-for="model in enabledModels" :key="model.id" class="ai-check"
          ><input
            v-model="defaults.participantIds"
            type="checkbox"
            :value="model.id"
            :disabled="busy || !client.desktop"
          />{{ model.displayName }}</label
        ><small v-if="!enabledModels.length">请先添加并启用模型。</small>
      </div>
      <label
        >默认汇总模型<select
          v-model="defaults.summaryModelId"
          aria-label="默认汇总模型"
          :disabled="busy || !client.desktop"
        >
          <option :value="null">请选择</option>
          <option
            v-for="model in enabledModels"
            :key="model.id"
            :value="model.id"
          >
            {{ model.displayName }}
          </option>
        </select></label
      >
      <button
        aria-label="保存默认模型"
        :disabled="busy || !client.desktop || !enabledModels.length"
        @click="saveDefaults"
      >
        保存默认模型
      </button>
    </section>
  </section>
</template>
