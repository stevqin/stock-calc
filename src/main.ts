import { createApp, h } from "vue";
import App from "./TradingDesk.vue";
import OverlayScrollbar from "./components/OverlayScrollbar.vue";
import "./workspace.css";

createApp({ render: () => [h(App), h(OverlayScrollbar)] }).mount("#app");
