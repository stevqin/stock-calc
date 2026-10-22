import { createApp, defineComponent, h, ref } from "vue";
import LedgerWorkbench from "../../src/LedgerWorkbench.vue";
import { draftRecord, insertRecord, manualAccount } from "../../src/sim/record";
import "../../src/workspace.css";
const account = manualAccount();
for (const [kind, price, quantity, time] of [
  ["buy", "10.1234", "1000", "2026-08-25T01:00:00.000Z"],
  ["sell", "12", "500", "2026-08-26T01:00:00.000Z"],
  ["sell", "11", "500", "2026-08-27T01:00:00.000Z"],
  ["buy", "10.80", "500", "2026-08-27T02:00:00.000Z"],
  ["sell", "12", "100", "2026-08-28T01:00:00.000Z"],
  ["buy", "11", "100", "2026-08-28T02:00:00.000Z"],
  ["sell", "12", "500", "2026-08-31T01:00:00.000Z"],
  ["buy", "10.40", "200", "2026-09-01T01:00:00.000Z"],
  ["sell", "11.30", "50", "2026-09-02T01:00:00.000Z"],
] as const)
  insertRecord(
    account,
    draftRecord(
      account,
      "sh510300",
      kind,
      price,
      quantity,
      time,
      "合成记录，用于检查长备注的悬停显示",
      { commission: "1.23", stamp: "0", transfer: "0" },
    ).entry,
  );
createApp(
  defineComponent({
    setup() {
      const compact = ref(true);
      const requestedWidth = new URLSearchParams(location.search).get("width");
      const previewWidth = Number(requestedWidth) || 0;
      return () =>
        h(
          "main",
          {
            style: previewWidth
              ? `width:${previewWidth}px;transform:scale(${Math.min(1, (window.innerWidth - 32) / previewWidth)});transform-origin:top left;margin:24px 16px;background:white;height:680px;display:flex;flex-direction:column`
              : `width:min(${compact.value ? 640 : 1180}px,calc(100vw - 32px));margin:24px auto;background:white;height:680px;display:flex;flex-direction:column`,
          },
          [
            h(
              "button",
              {
                onClick: () => (compact.value = !compact.value),
                style: "align-self:flex-start;margin:8px",
              },
              compact.value ? "查看全局历史" : "查看股票详情",
            ),
            h(LedgerWorkbench, {
              key: String(compact.value),
              embedded: true,
              initialTab: "trades",
              historySecurityId: compact.value ? "sh510300" : undefined,
              historyReadOnly: compact.value,
              historyPrice: "12",
              snapshot: { account, revision: 1 },
            }),
          ],
        );
    },
  }),
).mount("#app");
