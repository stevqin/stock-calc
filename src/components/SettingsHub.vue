<script setup lang="ts">
import { ref } from "vue";
import ModelSettings from "../ai/ModelSettings.vue";
import LedgerWorkbench from "../LedgerWorkbench.vue";
import type { Account } from "../sim/model";
defineProps<{
  snapshot: { account: Account; revision: number };
  symbol: string;
}>();
const emit = defineEmits<{ saved: [account: Account, revision: number] }>();
const section = ref<"ai" | "fees">("ai");
</script>
<template>
  <section class="settings-hub" aria-label="设置">
    <aside class="settings-sidebar">
      <div class="settings-sidebar-heading">
        <h1>设置</h1>
        <p>模型与交易偏好</p>
      </div>
      <nav aria-label="设置分类">
        <div class="settings-category" :class="{ selected: section === 'ai' }">
          <button
            :aria-current="section === 'ai' ? 'page' : undefined"
            @click="section = 'ai'"
          >
            AI 模型</button
          ><small>服务连接与默认模型</small>
        </div>
        <div
          class="settings-category"
          :class="{ selected: section === 'fees' }"
        >
          <button
            :aria-current="section === 'fees' ? 'page' : undefined"
            @click="section = 'fees'"
          >
            费用设置</button
          ><small>股票与 ETF 独立费率</small>
        </div>
      </nav>
      <p class="settings-local-note">配置保存在本机</p>
    </aside>
    <div
      class="settings-content"
      :aria-label="section === 'ai' ? 'AI 模型配置' : '交易费用配置'"
    >
      <header v-if="section === 'fees'" class="settings-fees-heading">
        <h2>交易费用</h2>
        <p>对照券商交割单填写股票与 ETF 的实际费率。</p>
      </header>
      <KeepAlive>
        <ModelSettings v-if="section === 'ai'" />
        <LedgerWorkbench
          v-else
          embedded
          initial-tab="fees"
          :symbol="symbol"
          :snapshot="snapshot"
          @saved="(account, revision) => emit('saved', account, revision)"
        />
      </KeepAlive>
    </div>
  </section>
</template>
<style scoped>
.settings-hub {
  display: grid;
  grid-template-columns: 190px minmax(0, 1fr);
  flex: 1;
  min-height: 0;
  width: 100%;
  background: #f3f6fa;
  border-top: 1px solid #e4eaf2;
}
.settings-sidebar {
  display: flex;
  flex-direction: column;
  border-right: 1px solid #e1e7f0;
  padding: 28px 14px 20px;
  background: #f7f9fc;
}
.settings-sidebar-heading {
  padding: 0 14px 26px;
}
.settings-sidebar-heading h1 {
  font-size: 22px;
  line-height: 1.3;
  letter-spacing: -0.6px;
  font-weight: 650;
  margin: 0 0 8px;
}
.settings-sidebar-heading p {
  color: #758293;
  font-size: 12px;
}
.settings-sidebar nav {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.settings-category {
  position: relative;
  border-radius: 7px;
  padding: 0 12px 12px;
  border: 1px solid transparent;
}
.settings-category button {
  width: 100%;
  min-height: 38px;
  padding: 10px 0 4px;
  border: 0;
  background: transparent;
  box-shadow: none;
  text-align: left;
  justify-content: flex-start;
  color: #31445f;
  font-size: 13px;
  font-weight: 600;
}
.settings-category small {
  display: block;
  font-size: 11px;
  color: #7a8799;
  line-height: 1.5;
}
.settings-category.selected {
  background: #eaf0fc;
  border-color: #dae5fb;
}
.settings-category.selected::before {
  content: "";
  position: absolute;
  left: 0;
  top: 14px;
  bottom: 14px;
  width: 3px;
  background: #3268cf;
  border-radius: 2px;
}
.settings-category.selected button {
  color: #255fbe;
}
.settings-category button:focus-visible {
  outline: 2px solid #3268cf;
  outline-offset: 3px;
}
.settings-local-note {
  margin-top: auto;
  padding: 28px 14px 0;
  color: #8793a5;
  font-size: 11px;
}
.settings-content {
  min-width: 0;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 28px 30px 36px;
}
.settings-content :deep(.ai-settings) {
  max-width: 1120px;
  margin: 0;
  padding: 0;
}
.settings-content :deep(.ai-settings-heading) {
  margin-bottom: 20px;
}
.settings-content :deep(.ai-settings-heading h2) {
  font-size: 20px;
  letter-spacing: -0.3px;
}
.settings-content :deep(.ai-defaults) {
  max-width: none;
}
.settings-content :deep(.ai-default-list) {
  gap: 10px 24px;
}
.settings-fees {
  max-width: 1120px;
}
.settings-fees-heading {
  margin-bottom: 20px;
}
.settings-fees-heading h2 {
  font-size: 20px;
  margin: 0 0 8px;
  letter-spacing: -0.3px;
}
.settings-fees-heading p {
  font-size: 13px;
  color: #758293;
  line-height: 1.6;
}
.settings-content :deep(.ledger-embedded) {
  height: auto;
}
.settings-content :deep(.details.panel) {
  padding: 0;
  background: transparent;
  box-shadow: none;
  overflow: visible;
}
.settings-content :deep(.fee-settings) {
  flex: 0 0 auto;
  overflow: visible;
  padding: 0;
  gap: 18px;
}
@media (max-width: 1100px) {
  .settings-hub {
    grid-template-columns: 165px minmax(0, 1fr);
  }
  .settings-content {
    padding: 24px 22px;
  }
  .settings-content :deep(.ai-settings-grid) {
    grid-template-columns: 1fr;
  }
}
</style>
