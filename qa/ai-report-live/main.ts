import { createApp, h } from "vue";
import StockAnalysisDrawer from "../../src/ai/StockAnalysisDrawer.vue";
import { security } from "./fixture";
import "../../src/terminal-base.css";
import "../../src/workspace.css";
import "../../src/ai/ai.css";
createApp({ render: () => h(StockAnalysisDrawer, { security }) }).mount("#app");
