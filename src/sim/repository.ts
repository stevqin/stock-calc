import { invoke, isTauri } from "@tauri-apps/api/core";
import { validateAccount } from "./ledger";
import { manualAccount, upgradeAccount } from "./record";
import type { Account } from "./model";
const KEY = "t-calculator.simulation.v2";
interface Stored {
  revision: number;
  payload: string | null;
}
export async function loadAccount(): Promise<{
  account: Account;
  revision: number;
}> {
  const saved: Stored = isTauri()
    ? await invoke("load_account")
    : JSON.parse(localStorage.getItem(KEY) || '{"revision":0,"payload":null}');
  if (saved.payload)
    return {
      account: upgradeAccount(JSON.parse(saved.payload)),
      revision: saved.revision,
    };
  let legacy;
  try {
    legacy = JSON.parse(localStorage.getItem("t-calculator.v1") || "null");
  } catch {}
  return { account: manualAccount(legacy), revision: 0 };
}
export async function saveAccount(
  account: Account,
  revision: number,
): Promise<number> {
  validateAccount(account);
  const payload = JSON.stringify(account);
  if (isTauri())
    return (
      await invoke<Stored>("save_account", {
        payload,
        expectedRevision: revision,
      })
    ).revision;
  const current = JSON.parse(localStorage.getItem(KEY) || '{"revision":0}');
  if (current.revision !== revision)
    throw new Error("其他窗口已更新账户，请重新加载");
  if (current.payload) {
    const rows = JSON.parse(
      localStorage.getItem("t-calculator.recovery.v1") || "[]",
    );
    rows.unshift({
      revision: current.revision,
      payload: current.payload,
      time: new Date().toISOString(),
    });
    localStorage.setItem(
      "t-calculator.recovery.v1",
      JSON.stringify(rows.slice(0, 20)),
    );
  }
  localStorage.setItem(
    KEY,
    JSON.stringify({ revision: revision + 1, payload }),
  );
  return revision + 1;
}
export async function exportAccount(account: Account): Promise<string> {
  if (isTauri())
    return (await invoke<string | null>("export_account")) || "已取消导出";
  const blob = new Blob(
    [
      JSON.stringify(
        {
          format: "t-calculator-backup",
          version: account.schemaVersion,
          exportedAt: new Date().toISOString(),
          account,
        },
        null,
        2,
      ),
    ],
    { type: "application/json" },
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "T刻-证券账本备份.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return "已导出备份";
}
