import { createApp, h } from "vue";
import LedgerWorkbench from "../../src/LedgerWorkbench.vue";
import { draftRecord, insertRecord, manualAccount } from "../../src/sim/record";
import "../../src/workspace.css";

const account = manualAccount();
for (const [id, time] of [
  ["sh510300", "2026-08-25T01:00:00.000Z"],
  ["sz159915", "2026-08-26T01:00:00.000Z"],
] as const) {
  insertRecord(
    account,
    draftRecord(account, id, "buy", "10", "100", time, "", {
      commission: "0.50",
      stamp: "0",
      transfer: "0",
    }).entry,
  );
}

document.body.style.cssText =
  'margin:0;background:#edf1f6;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif';
createApp({
  render: () =>
    h(
      "main",
      {
        style:
          "width:min(640px,calc(100vw - 32px));margin:24px auto;background:white;min-height:520px;overflow:auto",
      },
      [
        h(LedgerWorkbench, {
          embedded: true,
          initialTab: "trades",
          snapshot: { account, revision: 1 },
        }),
      ],
    ),
}).mount("#app");
