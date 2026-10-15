import { expect, it } from "vitest";
import { readableReportText } from "./reportText";
it("把内部状态翻译成普通语言，保留价格股数和否定含义", () => {
  const v = readableReportText(
    "policy为tFirst且tPercent为100，但verifiedTCandidates为空；quoteIsCurrent为false，本次不生成做T预案。L2=31.51元，200股。",
  );
  expect(v).toContain("100%");
  expect(v).toContain("报价未通过更新时间检查");
  expect(v).toContain("本次不生成");
  expect(v).toContain("L2=31.51元，200股");
  expect(v).not.toMatch(/tFirst|tPercent|verifiedTCandidates|quoteIsCurrent/);
});
