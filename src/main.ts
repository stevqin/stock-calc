import { createApp, h } from "vue";

async function start() {
  if (new URLSearchParams(location.search).has("status-panel")) {
    document.body.classList.add("status-panel-window");
    const { default: StatusPanel } = await import("./StatusPanel.vue");
    createApp(StatusPanel).mount("#app");
  } else {
    const [{ default: App }, { default: OverlayScrollbar }] = await Promise.all(
      [
        import("./TradingDesk.vue"),
        import("./components/OverlayScrollbar.vue"),
        import("./workspace.css"),
      ],
    );
    createApp({ render: () => [h(App), h(OverlayScrollbar)] }).mount("#app");
  }
}
void start();
