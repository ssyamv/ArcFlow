import { defineStore } from "pinia";
import { ref } from "vue";
import { fetchExecutions, triggerWorkflow, type TriggerResponse } from "../api/workflow";

export interface WorkflowExecution {
  id: number;
  workflow_type: string;
  trigger_source: string;
  plane_issue_id: string | null;
  status: string;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export const useWorkflowStore = defineStore("workflow", () => {
  const executions = ref<WorkflowExecution[]>([]);
  const total = ref(0);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function loadExecutions(filters?: {
    workflow_type?: string;
    status?: string;
    limit?: number;
  }) {
    loading.value = true;
    error.value = null;
    try {
      const result = await fetchExecutions(filters);
      executions.value = result.data;
      total.value = result.total;
    } catch (e) {
      error.value = e instanceof Error ? e.message : "加载失败";
    } finally {
      loading.value = false;
    }
  }

  async function trigger(params: {
    workflow_type: string;
    plane_issue_id: string;
    input_path?: string;
  }): Promise<TriggerResponse> {
    const result = await triggerWorkflow(params);
    await loadExecutions();
    return result;
  }

  return { executions, total, loading, error, loadExecutions, trigger };
});
