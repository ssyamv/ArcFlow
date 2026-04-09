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
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { fetchExecution, type ExecutionDetail } from "@/api/workflow";
import { typeLabel } from "@/utils/workflow";

defineOptions({ name: "WorkflowDetail" });

const route = useRoute();
const id = Number(route.params.id);
const execution = ref<ExecutionDetail | null>(null);
const loading = ref(true);
const error = ref("");

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

onMounted(async () => {
  try {
    execution.value = await fetchExecution(id);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "加载失败";
  } finally {
    loading.value = false;
  }
});
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
