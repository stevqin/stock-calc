import { createApp, defineComponent, h, ref } from "vue";
import OverlayScrollbar from "../../src/components/OverlayScrollbar.vue";
import "../../src/workspace.css";
createApp(
  defineComponent({
    setup() {
      const area = ref<HTMLElement>();
      return () => [
        h("main", { style: "padding:32px" }, [
          h("h2", "悬浮滚动条验收 · 合成内容"),
          h(
            "p",
            "不连接账本。观察滚动前、滚动中与停止后的宽度；支持拖动及键盘操作。",
          ),
          h("div", { style: "display:flex;gap:12px;margin:16px 0" }, [
            h(
              "button",
              { onClick: () => area.value?.scrollBy({ top: 120 }) },
              "向下滚动",
            ),
            h(
              "button",
              { onClick: () => area.value?.scrollBy({ top: -120 }) },
              "向上滚动",
            ),
            h(
              "button",
              { onClick: () => area.value?.scrollBy({ left: 80 }) },
              "横向滚动",
            ),
          ]),
          h(
            "section",
            {
              ref: area,
              tabindex: 0,
              "aria-label": "验收滚动区域",
              style:
                "width:320px;height:220px;overflow:auto;border:1px solid #dfe7f1;background:white",
            },
            Array.from({ length: 30 }, (_, i) =>
              h(
                "div",
                {
                  style:
                    "width:420px;height:36px;padding:8px;border-bottom:1px solid #edf1f6",
                },
                `示例记录 ${i + 1} · 仅用于验证滚动`,
              ),
            ),
          ),
        ]),
        h(OverlayScrollbar),
      ];
    },
  }),
).mount("#app");
