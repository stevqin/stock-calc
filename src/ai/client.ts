import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  ModelConfig,
  ModelConfigInput,
  ModelDefaults,
  TaskDetail,
  HistoryQuery,
  HistoryPage,
} from "./types";
export interface ModelTestResult {
  modelId: string;
  attempts: number;
  usage: unknown | null;
}
export interface ModelClient {
  desktop: boolean;
  listModels(): Promise<ModelConfig[]>;
  saveModel(
    input: ModelConfigInput,
    replacementSecret: string | null,
  ): Promise<ModelConfig>;
  deleteModel(id: string): Promise<void>;
  getDefaults(): Promise<ModelDefaults>;
  saveDefaults(defaults: ModelDefaults): Promise<void>;
  listModelVersions(id: string): Promise<string[]>;
  testModel(id: string): Promise<ModelTestResult>;
}
export const modelClient: ModelClient = {
  desktop: isTauri(),
  listModels: () => invoke("ai_list_models"),
  saveModel: (input, replacementSecret) =>
    invoke("ai_save_model", { input, replacementSecret }),
  deleteModel: (id) => invoke("ai_delete_model", { id }),
  getDefaults: () => invoke("ai_get_defaults"),
  saveDefaults: (defaults) => invoke("ai_save_defaults", { defaults }),
  listModelVersions: (id) => invoke("ai_list_model_versions", { id }),
  testModel: (id) => invoke("ai_test_model", { id }),
};
export const loadTask = (taskId: string) =>
  invoke<TaskDetail>("ai_get_task", { taskId });
export const listHistory = (query: HistoryQuery) =>
  invoke<HistoryPage>("ai_list_history", { query });
export const deleteTask = (taskId: string) =>
  invoke<void>("ai_delete_task", { taskId });
export function aiErrorMessage(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  )
    return error.message;
  return "AI 操作失败，请检查配置或稍后重试";
}
