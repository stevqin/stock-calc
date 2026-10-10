import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import StatusIntradayChart from "./StatusIntradayChart.vue";
import { marketCharts } from "../market";

const key = "sh600519:intraday";
afterEach(() => delete marketCharts[key]);

describe("菜单栏弹窗分时图", () => {
  it("renders price, average, previous close and red/green volume without repeating quote metrics", () => {
    marketCharts[key] = {
      symbol: "sh600519",
      mode: "intraday",
      adjustment: "实时",
      fetchedAt: "2026-10-10T10:02:00+08:00",
      bars: [],
      sessions: [
        {
          date: "20261010",
          previousClose: "100",
          points: [
            { time: "0930", price: "101", volume: "100", amount: "1010000" },
            { time: "0932", price: "99", volume: "220", amount: "2200000" },
          ],
        },
      ],
    };
    const wrapper = mount(StatusIntradayChart, {
      props: {
        security: {
          id: "sh600519",
          market: "sh",
          code: "600519",
          name: "贵州茅台",
        },
        active: false,
      },
    });
    expect(wrapper.get("header").text()).toContain("贵州茅台SH60051909:32");
    expect(wrapper.get(".price-line").attributes("d")).toContain("L");
    expect(wrapper.get(".average-line").attributes("d")).toContain("L");
    expect(wrapper.find(".previous-close").exists()).toBe(true);
    expect(wrapper.findAll(".volume-bar.up")).toHaveLength(1);
    expect(wrapper.findAll(".volume-bar.down")).toHaveLength(1);
    expect(wrapper.text()).not.toContain("+1.25%");
    wrapper.unmount();
  });
});
