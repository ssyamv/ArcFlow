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
          <div>
            <div class="field-label">Correlation ID</div>
            <div class="field-value font-mono text-xs break-all">
              {{ execution.correlation_id ?? "-" }}
            </div>
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
        v-if="execution.workflow_type === 'bug_analysis' && execution.bug_report_summary"
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
          Bug 报告摘要
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
          <div class="md:col-span-2">
            <div class="field-label">摘要</div>
            <div class="field-value">{{ execution.bug_report_summary.summary }}</div>
          </div>
          <div class="md:col-span-2">
            <div class="field-label">根因</div>
            <div class="field-value">{{ execution.bug_report_summary.root_cause }}</div>
          </div>
          <div class="md:col-span-2">
            <div class="field-label">建议修复</div>
            <div class="field-value">{{ execution.bug_report_summary.suggested_fix }}</div>
          </div>
          <div>
            <div class="field-label">置信度</div>
            <div class="field-value">{{ execution.bug_report_summary.confidence }}</div>
          </div>
          <div>
            <div class="field-label">下一步</div>
            <div class="field-value">
              {{ bugNextActionLabel(execution.bug_report_summary.next_action) }}
            </div>
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
        <div
          class="rounded-md p-4 mb-4"
          style="
            background-color: var(--color-surface-03);
            border: 1px solid var(--color-border-subtle);
          "
        >
          <div class="field-label">当前卡点</div>
          <div
            class="text-lg"
            style="font-weight: 510; color: var(--color-text-primary); letter-spacing: -0.02em"
          >
            {{ execution.current_stage_summary.label }}
          </div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-4">
          <div>
            <div class="field-label">目标</div>
            <div class="field-value">{{ execution.current_stage_summary.target ?? "-" }}</div>
          </div>
          <div>
            <div class="field-label">阶段</div>
            <div class="field-value">{{ execution.current_stage_summary.stage ?? "-" }}</div>
          </div>
          <div>
            <div class="field-label">状态</div>
            <div class="field-value">
              <span
                class="inline-flex items-center gap-1.5 text-xs"
                style="font-weight: 510"
                :style="{ color: statusColor(execution.current_stage_summary.status ?? '') }"
              >
                <span
                  class="w-1.5 h-1.5 rounded-full"
                  :style="{
                    backgroundColor: statusColor(execution.current_stage_summary.status ?? ''),
                  }"
                />
                {{ statusLabel(execution.current_stage_summary.status) }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div
        v-if="execution.workflow_diagnostics?.length"
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
          异常诊断
        </div>
        <div class="space-y-3">
          <div
            v-for="diagnostic in execution.workflow_diagnostics"
            :key="`${diagnostic.kind}-${diagnostic.dispatch_id ?? diagnostic.subtask_id ?? diagnostic.title}`"
            class="rounded-md p-3"
            style="border: 1px solid var(--color-border-subtle)"
          >
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span
                style="font-weight: 510; color: var(--color-text-primary)"
                data-testid="workflow-diagnostic-title"
              >
                {{ diagnostic.title }}
              </span>
              <span
                class="status-pill"
                style="border-color: var(--color-border-solid)"
                :style="{
                  color: severityColor(diagnostic.severity),
                  borderColor: `${severityColor(diagnostic.severity)}33`,
                }"
              >
                {{ severityLabel(diagnostic.severity) }}
              </span>
              <span class="field-value">{{ diagnostic.kind }}</span>
            </div>
            <div class="mt-2 text-xs break-all" style="color: var(--color-text-secondary)">
              {{ diagnostic.message }}
            </div>
            <div class="mt-2 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
              <div class="text-xs" style="color: var(--color-text-quaternary)">
                Target · {{ diagnostic.target ?? "-" }}
              </div>
              <div class="text-xs" style="color: var(--color-text-quaternary)">
                Stage · {{ diagnostic.stage ?? "-" }}
              </div>
              <div
                v-if="diagnostic.dispatch_id"
                class="text-xs break-all"
                style="color: var(--color-text-quaternary)"
              >
                Dispatch ID · {{ diagnostic.dispatch_id }}
              </div>
              <div
                v-if="diagnostic.subtask_id"
                class="text-xs"
                style="color: var(--color-text-quaternary)"
              >
                Subtask ID · {{ diagnostic.subtask_id }}
              </div>
              <div
                v-if="diagnostic.timestamp"
                class="text-xs"
                style="color: var(--color-text-quaternary)"
              >
                Time · {{ formatDiagnosticTimestamp(diagnostic.timestamp) }}
              </div>
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
                {{ dispatch.skill }}
              </span>
              <span
                class="status-pill"
                style="border-color: var(--color-border-solid)"
                :style="{
                  color: statusColor(dispatch.status),
                  borderColor: `${statusColor(dispatch.status)}33`,
                }"
              >
                {{ statusLabel(dispatch.status) }}
              </span>
              <span class="field-value">Dispatch ID {{ dispatch.id }}</span>
            </div>
            <div class="mt-2 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
              <div class="text-xs" style="color: var(--color-text-quaternary)">
                Source Stage · {{ dispatch.source_stage ?? "-" }}
              </div>
              <div class="text-xs" style="color: var(--color-text-quaternary)">
                Plane Issue · {{ dispatch.plane_issue_id ?? "-" }}
              </div>
              <div class="text-xs" style="color: var(--color-text-quaternary)">
                Created At · {{ formatTimestamp(dispatch.created_at) }}
              </div>
              <div class="text-xs" style="color: var(--color-text-quaternary)">
                Started At · {{ formatTimestamp(dispatch.started_at) }}
              </div>
              <div class="text-xs" style="color: var(--color-text-quaternary)">
                Last Callback · {{ formatTimestamp(dispatch.last_callback_at) }}
              </div>
              <div class="text-xs" style="color: var(--color-text-quaternary)">
                Completed At · {{ formatTimestamp(dispatch.completed_at) }}
              </div>
              <div class="text-xs" style="color: var(--color-text-quaternary)">
                Callback Replay · {{ dispatch.callback_replay_count }}
              </div>
              <div
                v-if="dispatch.correlation_id"
                class="text-xs md:col-span-2 break-all"
                style="color: var(--color-text-quaternary)"
              >
                Correlation ID · {{ dispatch.correlation_id }}
              </div>
              <div
                v-if="dispatch.result_summary"
                class="text-xs md:col-span-2 break-all"
                style="color: var(--color-text-secondary)"
              >
                Result Summary · {{ dispatch.result_summary }}
              </div>
              <div
                v-if="dispatch.diagnostic_flags.length"
                class="text-xs md:col-span-2 break-all"
                style="color: var(--color-text-quaternary)"
              >
                Diagnostic Flags · {{ dispatch.diagnostic_flags.join(", ") }}
              </div>
              <div
                v-if="dispatch.error_message"
                class="text-xs md:col-span-2 break-all"
                style="color: var(--color-error-light)"
              >
                错误输出 · {{ dispatch.error_message }}
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
            v-for="targetGroup in groupedSubtasks"
            :key="targetGroup.target"
            data-testid="trajectory-card"
            class="rounded-md p-3"
            style="border: 1px solid var(--color-border-subtle)"
          >
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span
                data-testid="trajectory-target"
                style="font-weight: 510; color: var(--color-text-primary)"
              >
                {{ targetGroup.target }}
              </span>
              <span
                data-testid="trajectory-status"
                class="status-pill"
                style="border-color: var(--color-border-solid)"
                :style="{
                  color: statusColor(targetGroup.status),
                  borderColor: `${statusColor(targetGroup.status)}33`,
                }"
              >
                {{ statusLabel(targetGroup.status) }}
              </span>
            </div>
            <div class="mt-2 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
              <div
                data-testid="trajectory-provider"
                class="text-xs"
                style="color: var(--color-text-quaternary)"
              >
                Provider · {{ targetGroup.provider }}
              </div>
              <div
                data-testid="trajectory-repo"
                class="text-xs"
                style="color: var(--color-text-quaternary)"
              >
                Repo · {{ targetGroup.repo_name ?? "-" }}
              </div>
              <div
                data-testid="trajectory-branch"
                class="text-xs"
                style="color: var(--color-text-quaternary)"
              >
                Branch · {{ targetGroup.branch_name ?? "-" }}
              </div>
              <div
                v-if="targetGroup.correlation_id"
                class="text-xs md:col-span-2 break-all"
                style="color: var(--color-text-quaternary)"
              >
                Correlation ID · {{ targetGroup.correlation_id }}
              </div>
            </div>
            <div class="mt-3 space-y-2">
              <div
                v-for="subtask in targetGroup.subtasks"
                :key="subtask.id"
                class="rounded-md p-3"
                style="background-color: var(--color-surface-03)"
              >
                <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span style="font-weight: 510; color: var(--color-text-primary)">
                    {{ subtask.stage }}
                  </span>
                  <span
                    class="status-pill"
                    style="border-color: var(--color-border-solid)"
                    :style="{
                      color: statusColor(subtask.status),
                      borderColor: `${statusColor(subtask.status)}33`,
                    }"
                  >
                    {{ statusLabel(subtask.status) }}
                  </span>
                </div>
                <div class="mt-2 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                  <div class="text-xs break-all" style="color: var(--color-text-quaternary)">
                    Artifact · {{ subtask.output_ref ?? "-" }}
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
import {
  fetchExecution,
  type ExecutionDetail,
  type WorkflowBugReportSummary,
} from "../api/workflow";
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
  timeout: "超时",
};

function statusColor(status: string) {
  const map: Record<string, string> = {
    pending: "var(--color-text-quaternary)",
    running: "var(--color-accent-violet)",
    success: "var(--color-success)",
    failed: "var(--color-error)",
    timeout: "var(--color-warning)",
  };
  return map[status] ?? "var(--color-text-quaternary)";
}

function statusLabel(status: string | null | undefined) {
  if (!status) return "-";
  return statusLabelMap[status] ?? status;
}

function severityLabel(severity: string) {
  const map: Record<string, string> = {
    info: "提示",
    warning: "警告",
    error: "错误",
  };
  return map[severity] ?? severity;
}

function severityColor(severity: string) {
  const map: Record<string, string> = {
    info: "var(--color-accent)",
    warning: "var(--color-warning)",
    error: "var(--color-error)",
  };
  return map[severity] ?? "var(--color-text-quaternary)";
}

function bugNextActionLabel(value: WorkflowBugReportSummary["next_action"]) {
  return value === "auto_fix_candidate" ? "可进入自动修复" : "需人工接管";
}

function formatTimestamp(value: number | null) {
  if (value == null) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  const pad = (part: number) => String(part).padStart(2, "0");
  return [date.getUTCFullYear(), pad(date.getUTCMonth() + 1), pad(date.getUTCDate())]
    .join("-")
    .concat(
      ` ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`,
    );
}

function formatDiagnosticTimestamp(value: number | string) {
  if (typeof value === "number") return formatTimestamp(value);
  return value;
}

const groupedSubtasks = computed(() => {
  const subtasks = execution.value?.subtasks ?? [];
  const groups = new Map<
    string,
    {
      target: string;
      provider: string;
      repo_name: string | null;
      branch_name: string | null;
      correlation_id: string | null;
      status: string;
      latestSubtaskId: number;
      subtasks: typeof subtasks;
    }
  >();

  for (const subtask of subtasks) {
    const existing = groups.get(subtask.target);
    if (existing) {
      existing.subtasks.push(subtask);
      if (subtask.id > existing.latestSubtaskId) {
        existing.latestSubtaskId = subtask.id;
        existing.status = subtask.status;
        existing.provider = subtask.provider;
        existing.repo_name = subtask.repo_name ?? null;
        existing.branch_name = subtask.branch_name ?? null;
        existing.correlation_id = subtask.correlation_id ?? null;
      }
      continue;
    }

    groups.set(subtask.target, {
      target: subtask.target,
      provider: subtask.provider,
      repo_name: subtask.repo_name ?? null,
      branch_name: subtask.branch_name ?? null,
      correlation_id: subtask.correlation_id ?? null,
      status: subtask.status,
      latestSubtaskId: subtask.id,
      subtasks: [subtask],
    });
  }

  return Array.from(groups.values());
});

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
