import { shallowReactive } from "vue";

export interface NoticeItem {
  id: number;
  message: string;
  kind: "info" | "warning" | "error";
  close: () => void;
}
// All producers share one teleported stack. The first active producer renders
// it, so embedded forms also work independently without a global app singleton.
export const noticeStack = shallowReactive<NoticeItem[]>([]);
let sequence = 0;
export function nextNoticeId() {
  return ++sequence;
}
export function removeNotice(id: number) {
  const index = noticeStack.findIndex((n) => n.id === id);
  if (index !== -1) noticeStack.splice(index, 1);
}
