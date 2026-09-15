import { marketQuotes } from "./fixture";
import { createApp, h } from "vue";
import MarketChart from "../../src/components/MarketChart.vue";
import "../../src/workspace.css";
import QuoteDetails from "../../src/components/QuoteDetails.vue";
import type { Quote } from "../../src/quotes";
const rawFields = Array(88).fill("");
Object.assign(rawFields, {
  0: "51",
  1: "示例证券",
  2: "002437",
  3: "3.40",
  4: "3.51",
  5: "3.48",
  6: "1358018",
  7: "476308",
  8: "881710",
  9: "3.40",
  10: "30813",
  11: "3.39",
  12: "11463",
  13: "3.38",
  14: "14663",
  15: "3.37",
  16: "6597",
  17: "3.36",
  18: "9211",
  19: "3.41",
  20: "822",
  21: "3.42",
  22: "10081",
  23: "3.43",
  24: "9502",
  25: "3.44",
  26: "11882",
  27: "3.45",
  28: "21017",
  30: "20260915120009",
  31: "-0.11",
  32: "-3.13",
  33: "3.50",
  34: "3.40",
  36: "1358018",
  38: "6.46",
  39: "18.88",
  43: "2.85",
  44: "71.49",
  45: "75.82",
  46: "3.07",
  47: "3.86",
  48: "3.16",
  49: "0.77",
  51: "3.43",
  52: "23.84",
  53: "20.12",
  56: "1.19",
  57: "46520.1384",
  61: "GP-A",
  62: "10.75",
  63: "-15.63",
  64: "0",
  67: "5.10",
  68: "2.37",
  70: "-28.57",
  72: "2102676320",
  73: "2229868126",
  74: "15.42",
  76: "2102676320",
  82: "CNY",
});
const quote = {
  name: "示例证券",
  code: "002437",
  market: "sz",
  latest: "3.40",
  bid: "3.40",
  ask: "3.41",
  quoteTime: rawFields[30],
  fetchedAt: new Date().toISOString(),
  kind: "stock",
  rawFields,
} as Quote;
marketQuotes["sz002437"] = quote;
document.body.style.cssText =
  'margin:0;overflow:auto;background:#edf1f6;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif';
createApp({
  render: () =>
    h(
      "main",
      {
        style:
          "width:608px;padding:16px;margin:0 auto;background:white;min-height:100vh;",
      },
      [
        h(
          QuoteDetails,
          {
            quote,
            security: { id: "sz002437", market: "sz", code: "002437" },
            mode: new URLSearchParams(location.search).has("daily")
              ? "daily"
              : new URLSearchParams(location.search).has("five")
                ? "five-day"
                : "intraday",
          },
          {
            chart: ({
              setChipVisible,
            }: {
              setChipVisible: (visible: boolean) => void;
            }) =>
              h("div", [
                h(
                  "div",
                  {
                    style:
                      "height:34px;line-height:34px;border-bottom:1px solid #edf1f6;font-size:12px;color:#3268cf",
                  },
                  "分时　 五日　 日K",
                ),
                h(
                  "div",
                  { style: "height:408px;display:flex;flex-direction:column" },
                  [
                    h(MarketChart, {
                      security: {
                        id: "sz002437",
                        market: "sz",
                        code: "002437",
                        name: "示例证券",
                        asset: "stock",
                        category: "domestic",
                        settlement: "T+1",
                      },
                      mode: new URLSearchParams(location.search).has("daily")
                        ? "daily"
                        : new URLSearchParams(location.search).has("five")
                          ? "five-day"
                          : "intraday",
                      onChipsVisibility: setChipVisible,
                      quoteStyle: true,
                      hideSnapshot: true,
                    }),
                  ],
                ),
              ]),
          },
        ),
      ],
    ),
}).mount("#app");
