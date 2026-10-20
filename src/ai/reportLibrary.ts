import type { TaskDetail } from "./types";
export function reportTitle(task: TaskDetail) {
  const group = task.requestSnapshot?.group;
  return group
    ? `${group.name} · 整批 ${task.requestSnapshot?.securities?.length ?? 0} 只`
    : (task.requestSnapshot?.securities?.[0]?.name ?? "股票报告");
}
export function reportCodes(task: TaskDetail) {
  return (task.requestSnapshot?.securities ?? [])
    .map((s) => s.code ?? "")
    .filter(Boolean)
    .join("、");
}
export function reportModels(task: TaskDetail) {
  const names = [
    ...new Set(
      (task.reports ?? [])
        .map((r) => r.modelSnapshot?.displayName)
        .filter(Boolean),
    ),
  ];
  return names.length
    ? names.join("、")
    : `已选 ${task.requestSnapshot?.participantIds?.length ?? 0} 个独立模型`;
}
export function reportCounts(task: TaskDetail) {
  return task.requestSnapshot?.group && !task.parentId
    ? `${task.requestSnapshot.securities?.length ?? 0} 只股票 · ${(task.groupSummaryVersions ?? []).length} 份整批汇总`
    : `${(task.reports ?? []).length} 份独立分析 · ${(task.summaryVersions ?? []).length} 次汇总`;
}
export function reportRunning(task: TaskDetail) {
  return ["pending", "collecting", "analyzing", "summarizing"].includes(
    task.status,
  );
}
export function reportStatus(task: TaskDetail) {
  const status =
    task.status === "partial" &&
    !(task.reports ?? []).some((r) => (r.validation as any)?.valid === true) &&
    !(task.summaryVersions ?? []).some(
      (s) => (s.validation as any)?.format === "markdown",
    )
      ? "failed"
      : task.status;
  return (
    (
      {
        pending: "等待开始",
        collecting: "采集资料",
        analyzing: "独立分析中",
        summarizing: "汇总中",
        completed: "已完成",
        partial: "部分完成",
        failed: "分析失败",
        cancelled: "已取消",
        interrupted: "上次运行已中断",
      } as Record<string, string>
    )[status] ?? "状态未知"
  );
}
export function reportDay(value: string) {
  const d = new Date(value);
  return Number.isFinite(d.getTime())
    ? d.toLocaleDateString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        timeZone: "Asia/Shanghai",
      })
    : "日期未知";
}
export function reportTime(value: string) {
  const d = new Date(value);
  return Number.isFinite(d.getTime())
    ? d.toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        timeZone: "Asia/Shanghai",
      })
    : "时间未知";
}
export function reportDate(value: string | null | undefined) {
  return value ? `${reportDay(value)} ${reportTime(value)}` : "时间未知";
}
export function matchesReport(task: TaskDetail, query: string) {
  const q = query.trim().toLocaleLowerCase();
  return (
    !q ||
    [
      reportTitle(task),
      reportCodes(task),
      reportModels(task),
      reportStatus(task),
      reportDate(task.createdAt),
      task.deletedAt ? reportDate(task.deletedAt) : "",
    ]
      .join(" ")
      .toLocaleLowerCase()
      .includes(q)
  );
}
export function reportGroups(tasks: TaskDetail[], trashed = false) {
  const groups = new Map<string, TaskDetail[]>();
  for (const task of tasks) {
    const day = reportDay(
      trashed ? (task.deletedAt ?? task.createdAt) : task.createdAt,
    );
    groups.set(day, [...(groups.get(day) ?? []), task]);
  }
  return [...groups].map(([day, items]) => ({ day, items }));
}
