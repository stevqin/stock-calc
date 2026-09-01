import { createApp, defineComponent, h, ref } from "vue";
import MarketChart from "../../src/components/MarketChart.vue";
import "../../src/workspace.css";
import type { ChartMode } from "../../src/sim/chart";
import type { Entry, Security } from "../../src/sim/model";
const security: Security = {
  id: "sh510300",
  market: "sh",
  code: "510300",
  name: "BS验收证券",
  asset: "etf",
  category: "domestic",
  settlement: "T+1",
};
const entries: Entry[] = ["2026-08-28", "2026-08-31"].flatMap((date) =>
  (["buy", "sell"] as const).map((kind, i) => ({
    id: date + kind,
    securityId: security.id,
    kind,
    date,
    time: `${date}T0${i + 2}:00:00Z`,
    price: i ? "10.12" : "10.00",
    quantity: i ? "100" : "200",
  })),
);
createApp(
  defineComponent({
    setup() {
      const mode = ref<ChartMode>("intraday");
      return () =>
        h("main", { style: "max-width:680px;padding:20px;margin:auto" }, [
          h("h2", "BS图表验收 · 合成数据"),
          h("p", "仅测试图表显示，不连接账户、不保存记录。"),
          h(
            "nav",
            { style: "display:flex;gap:8px;margin:16px 0" },
            (["intraday", "five-day", "daily"] as const).map((value, i) =>
              h(
                "button",
                { onClick: () => (mode.value = value) },
                ["分时", "五日分时", "日K"][i],
              ),
            ),
          ),
          h(
            "div",
            {
              class: "drawer-chart",
              style:
                "height:340px;display:flex;flex-direction:column;background:white",
            },
            [h(MarketChart, { security, mode: mode.value, trades: entries })],
          ),
        ]);
    },
  }),
).mount("#app");
