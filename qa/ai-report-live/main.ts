import { createApp, h } from "vue";
import StockAnalysisDrawer from "../../src/ai/StockAnalysisDrawer.vue";
import { security, previewPosition, previewCash } from "./fixture";
import "../../src/terminal-base.css";
import "../../src/workspace.css";
import "../../src/ai/ai.css";
const full = new URLSearchParams(location.search).has("full");
const cashOnly = new URLSearchParams(location.search).has("cashOnly");
createApp({
  render: () =>
    h(StockAnalysisDrawer, {
      security,
      ...(full
        ? {
            positionContext: cashOnly ? null : previewPosition,
            cashContext: previewCash,
          }
        : {}),
    }),
}).mount("#app");
