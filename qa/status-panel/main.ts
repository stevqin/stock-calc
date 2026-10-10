import { createApp } from "vue";
import StatusPanel from "../../src/StatusPanel.vue";
import { marketCharts } from "../../src/market";
marketCharts["sh563230:intraday"] = {
  symbol: "sh563230",
  mode: "intraday",
  adjustment: "实时",
  fetchedAt: new Date().toISOString(),
  bars: [],
  sessions: [
    {
      date: "20260908",
      previousClose: "1.220",
      points: [
        { time: "0930", price: "1.221", volume: "800", amount: "97700" },
        { time: "0945", price: "1.228", volume: "1800", amount: "221100" },
        { time: "1010", price: "1.224", volume: "2700", amount: "330100" },
        { time: "1040", price: "1.237", volume: "4100", amount: "504700" },
        { time: "1115", price: "1.233", volume: "5200", amount: "640500" },
        { time: "1305", price: "1.239", volume: "6400", amount: "789300" },
        { time: "1345", price: "1.231", volume: "7600", amount: "936900" },
        { time: "1420", price: "1.242", volume: "9000", amount: "1110000" },
        { time: "1455", price: "1.235", volume: "10300", amount: "1271000" },
      ],
    },
  ],
};
for (const id of ["sh600519", "sz002437", "sh603626", "sh510300"]) {
  marketCharts[`${id}:intraday`] = {
    ...marketCharts["sh563230:intraday"],
    symbol: id,
  };
}
document.body.classList.add("status-panel-window");
createApp(StatusPanel).mount("#app");
