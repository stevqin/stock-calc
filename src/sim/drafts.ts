import { invoke, isTauri } from "@tauri-apps/api/core";
let drafts: Record<string, unknown> = {};
let load: Promise<void> | undefined;
let pending = Promise.resolve();
export async function readDraft(key: string) {
  if (!load)
    load = (async () => {
      const raw = isTauri()
        ? await invoke<string>("load_drafts")
        : localStorage.getItem("t-calculator.drafts.v1") || "{}";
      const v = JSON.parse(raw);
      if (!v || typeof v !== "object" || Array.isArray(v))
        throw new Error("草稿损坏");
      drafts = v;
    })();
  await load;
  return drafts[key];
}
export function writeDraft(key: string, value: unknown) {
  drafts[key] = value;
  const payload = JSON.stringify(drafts);
  pending = pending
    .catch(() => {})
    .then(async () => {
      if (isTauri()) await invoke("save_drafts", { payload });
      else localStorage.setItem("t-calculator.drafts.v1", payload);
    });
  return pending;
}
export function flushDrafts() {
  return pending;
}
