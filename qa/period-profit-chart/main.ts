import { createApp, defineComponent, h, ref, onUnmounted } from "vue";
import PeriodProfitChart from "../../src/components/PeriodProfitChart.vue";
import type { Entry, CashEntry } from "../../src/sim/model";
import "../../src/terminal-base.css";
import "../../src/controls.css";
import "../../src/analysis.css";
let total = 0;
const full = Array.from({ length: 15 }, (_, i) => {
  const profit = [100, -70, 90.5, -180, 0, 150, -15.2][i % 7];
  total += profit;
  const capital = i >= 3 ? 500 : 0,
    cash = 30000 + capital,
    assets = 50000 + total + capital;
  return {
    date: `2026-10-${String(i + 1).padStart(2, "0")}`,
    profit: profit.toFixed(2),
    cumulativeProfit: total.toFixed(2),
    assets: assets.toFixed(2),
    cash: cash.toFixed(2),
    marketValue: (assets - cash).toFixed(2),
  };
});
const entry = (
  id: string,
  date: string,
  kind: Entry["kind"],
  securityId = "one",
): Entry => ({
  id,
  date,
  kind,
  securityId,
  time: `${date}T02:00:00.000Z`,
  price: kind === "buy" ? "10.20" : "10.60",
  quantity: "100",
});
const entries = [
  entry("b", "2026-10-02", "buy"),
  entry("s", "2026-10-03", "sell"),
  entry("tb", "2026-10-04", "buy"),
  entry("ts", "2026-10-04", "sell"),
  entry("otherb", "2026-10-10", "buy"),
  entry("others", "2026-10-10", "sell", "two"),
];
const cashEntries: CashEntry[] = [
  {
    id: "in",
    date: "2026-10-04",
    time: "2026-10-04T01:00:00.000Z",
    kind: "deposit",
    amount: "1000",
    note: "追加资金",
  },
  {
    id: "out",
    date: "2026-10-04",
    time: "2026-10-04T06:00:00.000Z",
    kind: "withdraw",
    amount: "500",
    note: "转出备用",
  },
];
if (new URLSearchParams(location.search).has("dense")) {
  full.splice(
    0,
    full.length,
    ...Array.from({ length: 365 }, (_, i) => {
      const date = new Date(Date.UTC(2025, 9, 21 + i))
        .toISOString()
        .slice(0, 10);
      return {
        date,
        profit: "0.00",
        assets: (1000000 + i / 3.64).toFixed(2),
        cash: "900000.00",
        marketValue: (100000 + i / 3.64).toFixed(2),
      };
    }),
  );
  entries.splice(
    0,
    entries.length,
    ...full.map((day, i) => entry(`dense-${i}`, day.date, "buy")),
  );
  cashEntries.splice(
    0,
    cashEntries.length,
    ...full.map((day, i) => ({
      id: `cash-${i}`,
      kind: "deposit" as const,
      date: day.date,
      time: `${day.date}T01:00:00.000Z`,
      amount: "100",
      note: "密集事件样例",
    })),
  );
}

if (new URLSearchParams(location.search).has("long")) {
  entries.push(
    ...Array.from({ length: 60 }, (_, i) =>
      entry(`long-${i}`, "2026-10-04", i % 2 ? "sell" : "buy", `security-${i}`),
    ),
  );
}
createApp(
  defineComponent({
    setup() {
      const refreshTick = ref(0);
      const refreshTimer = new URLSearchParams(location.search).has("refresh")
        ? setInterval(() => refreshTick.value++, 1000)
        : undefined;
      onUnmounted(() => clearInterval(refreshTimer));
      const missing = ref(false),
        short = ref(false);
      return () =>
        h(
          "main",
          {
            class: "pnl-analysis",
            "data-refresh-tick": refreshTick.value,
            style: "max-width:1400px;margin:24px auto;padding:0 16px",
          },
          [
            h("h2", "双轴盈亏与资产走势 · 虚构数据"),
            h("nav", { style: "display:flex;gap:8px;margin:14px 0" }, [
              h(
                "button",
                { onClick: () => (missing.value = !missing.value) },
                "切换缺失数据",
              ),
              h(
                "button",
                { onClick: () => (short.value = !short.value) },
                "切换时间区间",
              ),
            ]),
            h("div", { class: "pnl-insights" }, [
              h(PeriodProfitChart, {
                days: (short.value ? full.slice(8) : full).map((day, i) => ({
                  ...day,
                  profit: missing.value && i === 3 ? null : day.profit,
                  assets: missing.value && i === 3 ? null : day.assets,
                })),
                rangeStart: short.value ? full[8].date : full[0].date,
                rangeEnd: full.at(-1)!.date,
                hasRecords: true,
                entries,
                cashEntries,
                securityNames: { one: "示例股份", two: "另一股份" },
              }),
              h("section", { class: "pnl-panel pnl-contribution" }, [
                h("header", [h("h3", "证券盈亏贡献"), h("button", "放大查看")]),
                h("div", { class: "pnl-contribution-scroll" }, [
                  h("table", { class: "pnl-contribution-table" }, [
                    h("thead", [
                      h(
                        "tr",
                        ["证券", "区间盈亏", "区间收益率", "卖出盈亏"].map(
                          (label) => h("th", label),
                        ),
                      ),
                    ]),
                    h(
                      "tbody",
                      Array.from({ length: 30 }, (_, i) =>
                        h("tr", [
                          h("td", [`示例证券 ${i + 1}`, h("small", "600001")]),
                          h("td", "+100.00"),
                          h("td", "+1.00%"),
                          h("td", "+20.00"),
                        ]),
                      ),
                    ),
                  ]),
                ]),
              ]),
            ]),
          ],
        );
    },
  }),
).mount("#app");
