import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dateControlSources = [
  "LedgerWorkbench.vue",
  "Workspace.vue",
  "PnlAnalysis.vue",
  "components/HistoryEditor.vue",
];

describe("日期与日期时间控件", () => {
  it("业务页面不再使用浏览器原生日期控件", () => {
    for (const relativePath of dateControlSources) {
      const source = readFileSync(resolve("src", relativePath), "utf8");
      expect(source, relativePath).not.toMatch(
        /type=["'](?:date|datetime-local|month)["']/,
      );
    }
  });
});
