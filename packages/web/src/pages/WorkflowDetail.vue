<template>
  <div>
    <div class="flex items-center gap-3 mb-6">
      <router-link
        to="/workflows"
        class="text-sm transition-colors"
        style="color: var(--color-text-tertiary)"
        @mouseenter="($event.target as HTMLElement).style.color = 'var(--color-text-secondary)'"
        @mouseleave="($event.target as HTMLElement).style.color = 'var(--color-text-tertiary)'"
      >
        &larr; 返回列表
      </router-link>
      <h1
        class="text-2xl"
        style="font-weight: 510; color: var(--color-text-primary); letter-spacing: -0.288px"
      >
        执行详情 #{{ id }}
      </h1>
    </div>

    <!-- Loading -->
    <div
      v-if="loading"
      class="text-center py-10 text-sm"
      style="color: var(--color-text-quaternary)"
    >
      加载中...
    </div>

    <!-- Top-level Error -->
    <div
      v-else-if="error"
      class="p-4 rounded-md text-sm"
      style="
        background-color: rgba(239, 68, 68, 0.08);
        border: 1px solid rgba(239, 68, 68, 0.2);
        color: var(--color-error-light);
      "
    >
      {{ error }}
    </div>

    <!-- Detail Content -->
    <div v-else-if="execution" class="space-y-5">
      <!-- Basic Info Card -->
      <div
        class="rounded-lg p-5"
        style="
          background-color: var(--color-surface-02);
          border: 1px solid var(--color-border-default);
        "
      >
        <div
          class="text-xs uppercase mb-4"
          style="font-weight: 510; color: var(--color-text-quaternary); letter-spacing: 0.05em"
        >
          基本信息
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
          <div>
            <div class="field-label">工作流类型</div>
            <div class="field-value">
              <span class="status-pill" style="border-color: var(--color-border-solid)">
                {{ typeLabel(execution.workflow_type) }}
              </span>
            </div>
          </div>
          <div>
            <div class="field-label">触发来源</div>
            <div class="field-value">{{ execution.trigger_source }}</div>
          </div>
          <div>
            <div class="field-label">状态</div>
            <div class="field-value">
              <span
                class="inline-flex items-center gap-1.5 text-xs"
                style="font-weight: 510"
                :style="{ color: statusColor(execution.status) }"
              >
                <span
                  class="w-1.5 h-1.5 rounded-full"
                  :style="{ backgroundColor: statusColor(execution.status) }"
                />
                {{ statusLabelMap[execution.status] ?? execution.status }}
              </span>
            </div>
          </div>
          <div>
            <div class="field-label">Plane Issue ID</div>
            <div class="field-value">{{ execution.plane_issue_id ?? "-" }}</div>
          </div>
          <div v-if="execution.input_path">
            <div class="field-label">输入路径</div>
            <div class="field-value font-mono text-xs">{{ execution.input_path }}</div>
          </div>
        </div>
      </div>

      <!-- Timeline Card -->
      <div
        class="rounded-lg p-5"
        style="
          background-color: var(--color-surface-02);
          border: 1px solid var(--color-border-default);
        "
      >
        <div
          class="text-xs uppercase mb-4"
          style="font-weight: 510; color: var(--color-text-quaternary); letter-spacing: 0.05em"
        >
          时间线
        </div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-4">
          <div>
            <div class="field-label">创建时间</div>
            <div class="field-value">{{ execution.created_at }}</div>
          </div>
          <div>
            <div class="field-label">开始时间</div>
            <div class="field-value">{{ execution.started_at ?? "-" }}</div>
          </div>
          <div>
            <div class="field-label">完成时间</div>
            <div class="field-value">{{ execution.completed_at ?? "-" }}</div>
          </div>
        </div>
      </div>

      <div
        v-if="execution.current_stage_summary"
        class="rounded-lg p-5"
        style="
          background-color: var(--color-surface-02);
          border: 1px solid var(--color-border-default);
        "
      >
        <div
          class="text-xs uppercase mb-4"
          style="font-weight: 510; color: var(--color-text-quaternary); letter-spacing: 0.05em"
        >
          当前阶段摘要
        </div>
        <div class="grid grid-cols-1 md:grid-cols-5 gap-x-8 gap-y-4">
          <div>
            <div class="field-label">阶段</div>
            <div class="field-value">{{ execution.current_stage_summary.stage ?? "-" }}</div>
          </div>
          <div>
            <div class="field-label">状态</div>
            <div class="field-value">
              {{ execution.current_stage_summary.status ?? "-" }}
            </div>
          </div>
          <div>
            <div class="field-label">Dispatch 数</div>
            <div class="field-value">
              {{ execution.current_stage_summary.dispatch_count ?? "-" }}
            </div>
          </div>
          <div>
            <div class="field-label">最近 Dispatch 状态</div>
            <div class="field-value">
              {{ execution.current_stage_summary.last_dispatch_status ?? "-" }}
            </div>
          </div>
          <div>
            <div class="field-label">Callback 状态</div>
            <div class="field-value">
              {{ execution.current_stage_summary.callback_status ?? "-" }}
            </div>
          </div>
        </div>
      </div>

      <!-- Error Message -->
      <div
        v-if="execution.error_message"
        class="rounded-lg p-5"
        style="background-color: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.2)"
      >
        <div
          class="text-xs uppercase mb-3"
          style="font-weight: 510; color: var(--color-error-light); letter-spacing: 0.05em"
        >
          错误信息
        </div>
        <pre
          class="text-sm whitespace-pre-wrap overflow-auto p-3 rounded"
          style="
            font-family: ui-monospace, SFMono-Regular, &quot;SF Mono&quot;, Menlo, monospace;
            color: var(--color-error-light);
            background-color: rgba(239, 68, 68, 0.05);
          "
          >{{ execution.error_message }}</pre
        >
      </div>

      <div
        v-if="execution.dispatches?.length"
        class="rounded-lg p-5"
        style="
          background-color: var(--color-surface-02);
          border: 1px solid var(--color-border-default);
        "
      >
        <div
          class="text-xs uppercase mb-4"
          style="font-weight: 510; color: var(--color-text-quaternary); letter-spacing: 0.05em"
        >
          Dispatch / Callback 诊断
        </div>
        <div class="space-y-3">
          <div
            v-for="dispatch in execution.dispatches"
            :key="dispatch.id"
            class="rounded-md p-3"
            style="border: 1px solid var(--color-border-subtle)"
          >
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span style="font-weight: 510; color: var(--color-text-primary)">
                {{ dispatch.target ?? "-" }} · {{ dispatch.stage }}
              </span>
              <span class="status-pill" style="border-color: var(--color-border-solid)">
                {{ dispatch.status }}
              </span>
              <span class="field-value">Dispatch ID {{ dispatch.dispatch_id ?? "-" }}</span>
            </div>
            <div class="mt-2 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
              <div class="text-xs" style="color: var(--color-text-quaternary)">
                Provider · {{ dispatch.provider ?? "-" }}
              </div>
              <div class="text-xs" style="color: var(--color-text-quaternary)">
                Callback · {{ dispatch.callback_status ?? "-" }}
              </div>
              <div class="text-xs" style="color: var(--color-text-quaternary)">
                Repo · {{ dispatch.repo_name ?? "-" }}
              </div>
              <div class="text-xs" style="color: var(--color-text-quaternary)">
                Branch · {{ dispatch.branch_name ?? "-" }}
              </div>
              <div class="text-xs break-all" style="color: var(--color-text-quaternary)">
                输出路径 · {{ dispatch.output_path ?? "-" }}
              </div>
              <div class="text-xs" style="color: var(--color-text-quaternary)">
                日志 ·
                <a
                  v-if="dispatch.log_url"
                  :href="dispatch.log_url"
                  target="_blank"
                  rel="noreferrer"
                  class="no-underline"
                  style="color: var(--color-accent)"
                >
                  打开日志
                </a>
                <span v-else>-</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        v-if="execution.subtasks?.length"
        class="rounded-lg p-5"
        style="
          background-color: var(--color-surface-02);
          border: 1px solid var(--color-border-default);
        "
      >
        <div
          class="text-xs uppercase mb-4"
          style="font-weight: 510; color: var(--color-text-quaternary); letter-spacing: 0.05em"
        >
          目标轨迹与产物
        </div>
        <div class="space-y-3">
          <div
            v-for="subtask in execution.subtasks"
            :key="subtask.id"
            class="rounded-md p-3"
            style="border: 1px solid var(--color-border-subtle)"
          >
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span style="font-weight: 510; color: var(--color-text-primary)">
                {{ subtask.target }} · {{ subtask.stage }}
              </span>
              <span class="status-pill" style="border-color: var(--color-border-solid)">
                {{ statusLabelMap[subtask.status] ?? subtask.status }}
              </span>
            </div>
            <div class="mt-2 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
              <div class="text-xs" style="color: var(--color-text-quaternary)">
                Provider · {{ subtask.provider }}
              </div>
              <div class="text-xs" style="color: var(--color-text-quaternary)">
                Repo · {{ subtask.repo_name ?? "-" }}
              </div>
              <div class="text-xs" style="color: var(--color-text-quaternary)">
                Branch · {{ subtask.branch_name ?? "-" }}
              </div>
              <div class="text-xs" style="color: var(--color-text-quaternary)">
                日志 ·
                <a
                  v-if="subtask.log_url"
                  :href="subtask.log_url"
                  target="_blank"
                  rel="noreferrer"
                  class="no-underline"
                  style="color: var(--color-accent)"
                >
                  打开日志
                </a>
                <span v-else>-</span>
              </div>
              <div
                v-if="subtask.error_message"
                class="text-xs md:col-span-2 break-all"
                style="color: var(--color-error-light)"
              >
                错误输出 · {{ subtask.error_message }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        v-if="execution.links?.length"
        class="rounded-lg p-5"
        style="
          background-color: var(--color-surface-02);
          border: 1px solid var(--color-border-default);
        "
      >
        <div
          class="text-xs uppercase mb-4"
          style="font-weight: 510; color: var(--color-text-quaternary); letter-spacing: 0.05em"
        >
          关联工作流
        </div>
        <div class="space-y-3">
          <div
            v-for="link in execution.links"
            :key="link.id"
            class="rounded-md p-3"
            style="border: 1px solid var(--color-border-subtle)"
          >
            <div class="text-sm" style="font-weight: 510; color: var(--color-text-primary)">
              {{ link.link_type }}
            </div>
            <div class="text-xs" style="color: var(--color-text-quaternary)">
              <router-link
                :to="`/workflows/${link.source_execution_id}`"
                class="no-underline"
                style="color: var(--color-accent)"
              >
                #{{ link.source_execution_id }}
              </router-link>
              →
              <router-link
                :to="`/workflows/${link.target_execution_id}`"
                class="no-underline"
                style="color: var(--color-accent)"
              >
                #{{ link.target_execution_id }}
              </router-link>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { fetchExecution, type ExecutionDetail } from "../api/workflow";
import { typeLabel } from "../utils/workflow";

defineOptions({ name: "WorkflowDetail" });

const route = useRoute();
const id = computed(() => Number(route.params.id));
const execution = ref<ExecutionDetail | null>(null);
const loading = ref(true);
const error = ref("");
let activeRequest = 0;

const statusLabelMap: Record<string, string> = {
  pending: "待执行",
  running: "运行中",
  success: "成功",
  failed: "失败",
};

function statusColor(status: string) {
  const map: Record<string, string> = {
    pending: "var(--color-text-quaternary)",
    running: "var(--color-accent-violet)",
    success: "var(--color-success)",
    failed: "var(--color-error)",
  };
  return map[status] ?? "var(--color-text-quaternary)";
}

async function loadExecution(executionId: number) {
  activeRequest += 1;
  const requestId = activeRequest;
  loading.value = true;
  error.value = "";
  execution.value = null;

  try {
    const result = await fetchExecution(executionId);
    if (requestId === activeRequest) {
      execution.value = result;
    }
  } catch (e) {
    if (requestId === activeRequest) {
      error.value = e instanceof Error ? e.message : "加载失败";
    }
  } finally {
    if (requestId === activeRequest) {
      loading.value = false;
    }
  }
}

watch(
  id,
  (executionId) => {
    void loadExecution(executionId);
  },
  { immediate: true },
);
</script>

<style scoped>
.field-label {
  font-size: 12px;
  font-weight: 510;
  color: var(--color-text-quaternary);
  margin-bottom: 4px;
}

.field-value {
  font-size: 14px;
  font-weight: 400;
  color: var(--color-text-secondary);
}

.status-pill {
  font-size: 12px;
  font-weight: 510;
  padding: 1px 8px;
  border-radius: 9999px;
  border: 1px solid;
  color: var(--color-text-secondary);
}
</style>
