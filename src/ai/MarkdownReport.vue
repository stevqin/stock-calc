<script setup lang="ts">
import { computed } from "vue";
import MarkdownIt from "markdown-it";
const props = defineProps<{ text: string; incomplete?: boolean }>();
const md = new MarkdownIt({ html: false, breaks: true, linkify: false });
// Reports are untrusted prose. Images must not silently load third-party resources.
md.renderer.rules.image = (tokens, index) =>
  md.utils.escapeHtml(tokens[index].content);
const defaultLink =
  md.renderer.rules.link_open ??
  ((tokens, index, options, _env, self) =>
    self.renderToken(tokens, index, options));
md.renderer.rules.link_open = (tokens, index, options, env, self) => {
  tokens[index].attrSet("rel", "noopener noreferrer");
  tokens[index].attrSet("target", "_blank");
  return defaultLink(tokens, index, options, env, self);
};
const originalValidate = md.validateLink.bind(md);
md.validateLink = (url) =>
  originalValidate(url) && /^(https?:|mailto:|#)/i.test(url);
const html = computed(() => md.render(props.text));
</script>
<template>
  <div class="ai-markdown-report">
    <p class="ai-markdown-note">AI 原文 · 价格与股数未由程序逐项核验</p>
    <p v-if="incomplete" class="ai-markdown-incomplete">
      正文不完整：生成达到长度上限，已保留收到的内容，没有自动重试。
    </p>
    <div class="ai-markdown-body" v-html="html"></div>
  </div>
</template>
<style scoped>
.ai-markdown-report {
  min-width: 0;
}
.ai-markdown-note {
  font-size: 11px;
  opacity: 0.65;
  margin: 6px 0 10px;
}
.ai-markdown-incomplete {
  font-size: 12px;
  color: var(--warning-color, #a46814);
}
.ai-markdown-body {
  font-size: 13px;
  line-height: 1.65;
  overflow-wrap: anywhere;
  min-width: 0;
}
.ai-markdown-body :deep(h1) {
  font-size: 18px;
  line-height: 1.4;
  margin: 10px 0;
}
.ai-markdown-body :deep(h2) {
  font-size: 15px;
  margin: 16px 0 8px;
}
.ai-markdown-body :deep(h3),
.ai-markdown-body :deep(h4) {
  font-size: 13px;
  margin: 12px 0 6px;
}
.ai-markdown-body :deep(p),
.ai-markdown-body :deep(ul),
.ai-markdown-body :deep(ol) {
  margin: 6px 0;
}
.ai-markdown-body :deep(ul),
.ai-markdown-body :deep(ol) {
  padding-left: 20px;
}
.ai-markdown-body :deep(table) {
  display: block;
  max-width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
  margin: 10px 0;
  font-size: 12px;
}
.ai-markdown-body :deep(th),
.ai-markdown-body :deep(td) {
  padding: 7px 9px;
  border: 1px solid var(--border-color, #8884);
  min-width: 80px;
  text-align: left;
  vertical-align: top;
}
.ai-markdown-body :deep(th) {
  background: #8881;
  text-align: left;
}
.ai-markdown-body :deep(table strong) {
  white-space: nowrap;
}
.ai-markdown-body :deep(strong) {
  font-weight: 700;
}
.ai-markdown-body :deep(pre) {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  padding: 10px;
  background: #8881;
}
.ai-markdown-body :deep(blockquote) {
  margin: 8px 0;
  padding-left: 10px;
  border-left: 3px solid #8886;
  opacity: 0.85;
}
</style>
