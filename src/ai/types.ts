export type Asset = "stock" | "etf";
export type TaskStatus =
  | "pending"
  | "collecting"
  | "analyzing"
  | "summarizing"
  | "completed"
  | "partial"
  | "failed"
  | "cancelled"
  | "interrupted";
export interface AiError {
  code: string;
  message: string;
  retryable: boolean;
}
export interface SecurityRef {
  id: string;
  market: string;
  code: string;
  name: string;
  asset: Asset;
}
export interface ModelConfig {
  id: string;
  displayName: string;
  provider: string;
  baseUrl: string;
  model: string;
  enabled: boolean;
}
export interface ModelConfigInput extends Omit<ModelConfig, "id"> {
  id: string | null;
}
export interface ModelDefaults {
  participantIds: string[];
  summaryModelId: string | null;
}
export interface GroupRef {
  id: string;
  name: string;
  memberIds: string[];
}
export interface StartRequest {
  requestId: string;
  securities: SecurityRef[];
  group: GroupRef | null;
  participantIds: string[];
  summaryModelId: string;
}
export interface Evidence {
  id: string;
  securityId: string;
  kind: string;
  source: string;
  url: string | null;
  publishedAt: string | null;
  timePrecision: string;
  eventAt: string | null;
  collectedAt: string;
  content: string;
  contentHash: string;
  availability: string;
}
export interface Snapshot {
  id: string;
  security: SecurityRef;
  cutoffAt: string;
  frozenAt: string;
  referencePrice: string | null;
  windows: unknown;
  series: unknown;
  indicators: unknown;
  evidence: Evidence[];
  sourceStates: unknown;
  ruleVersions: unknown;
}
export interface IndependentReport {
  id: string;
  snapshotId: string;
  modelSnapshot: ModelConfig;
  windows: unknown;
  claims: unknown;
  rawOutput: string;
  validation: unknown;
  usage: unknown | null;
}
export interface SummaryVersion {
  id: string;
  snapshotId: string;
  version: number;
  inputReportIds: string[];
  summaryModelSnapshot: ModelConfig;
  windows: unknown;
  keyClaims: unknown;
  disagreements: unknown;
  validation: unknown;
}
export interface TaskDetail {
  id: string;
  parentId: string | null;
  createdAt: string;
  status: TaskStatus;
  securitySnapshots: Snapshot[];
  requestSnapshot: StartRequest;
  progress: unknown;
  callAttempts: unknown[];
  reports: IndependentReport[];
  summaryVersions: SummaryVersion[];
  groupSummaryVersions: unknown[];
  errors: AiError[];
}
export interface HistoryQuery {
  securityId?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: TaskStatus;
  cursor?: string;
  limit?: number;
}
export interface HistoryPage {
  items: TaskDetail[];
  nextCursor: string | null;
}
export function parseSnapshot(value: unknown): Snapshot {
  if (!value || typeof value !== "object") throw new Error("AI 快照格式无效");
  const s = value as Snapshot;
  if (
    !s.security ||
    s.security.id !== s.security.market + s.security.code ||
    !["stock", "etf"].includes(s.security.asset) ||
    !Array.isArray(s.evidence) ||
    s.evidence.some((e) => e.securityId !== s.security.id) ||
    (s.referencePrice !== null && typeof s.referencePrice !== "string")
  )
    throw new Error("AI 快照证券或证据无效");
  return s;
}
