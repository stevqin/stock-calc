import { createApp } from "vue";
import StatusPanel from "../../src/StatusPanel.vue";
document.body.classList.add("status-panel-window");
createApp(StatusPanel).mount("#app");
