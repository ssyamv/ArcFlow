<template>
  <div>
    <h1
      class="text-2xl mb-6"
      style="font-weight: 510; color: var(--color-text-primary); letter-spacing: -0.288px"
    >
      工作流执行记录
    </h1>

    <!-- Filter Pills -->
    <div class="flex flex-wrap gap-2 mb-5">
      <span
        class="text-xs uppercase mr-2 self-center"
        style="font-weight: 510; color: var(--color-text-quaternary); letter-spacing: 0.05em"
      >
        类型
      </span>
      <button
        v-for="t in typeOptions"
        :key="t.value"
        class="filter-pill"
        :class="{ active: filterType === t.value }"
        @click="
          filterType = t.value;
          loadData();
        "
      >
        {{ t.label }}
      </button>

      <span
        class="w-px h-5 self-center mx-2"
        style="background-color: var(--color-border-default)"
      />

      <span
        class="text-xs uppercase mr-2 self-center"
        style="font-weight: 510; color: var(--color-text-quaternary); letter-spacing: 0.05em"
      >
        状态
      </span>
      <button
        v-for="s in statusOptions"
        :key="s.value"
        class="filter-pill"
        :class="{ active: filterStatus === s.value }"
        @click="
          filterStatus = s.value;
          loadData();
        "
      >
        {{ s.label }}
      </button>
    </div>

    <!-- Error -->
    <div
      v-if="store.error"
      class="mb-4 p-3 rounded-md text-sm"
      style="
        background-color: rgba(239, 68, 68, 0.08);
        border: 1px solid rgba(239, 68, 68, 0.2);
        color: var(--color-error-light);
      "
    >
      {{ store.error }}
    </div>

    <!-- Loading -->
    <div
      v-if="store.loading"
      class="text-center py-10 text-sm"
      style="color: var(--color-text-quaternary)"
    >
      加载中...
    </div>

    <!-- Table -->
    <div v-else>
      <div class="rounded-lg overflow-hidden" style="border: 1px solid var(--color-border-default)">
        <table class="w-full">
          <thead>
            <tr style="border-bottom: 1px solid var(--color-border-subtle)">
              <th class="table-header">ID</th>
              <th class="table-header">类型</th>
              <th class="table-header">触发来源</th>
              <th class="table-header">Issue</th>
              <th class="table-header">状态</th>
              <th class="table-header">开始时间</th>
              <th class="table-header">完成时间</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="exec in store.executions"
              :key="exec.id"
              class="table-row cursor-pointer"
              @click="$router.push(`/workflows/${exec.id}`)"
            >
              <td class="table-cell" style="color: var(--color-text-tertiary)">#{{ exec.id }}</td>
              <td class="table-cell">
                <span class="status-pill" style="border-color: var(--color-border-solid)">
                  {{ typeLabel(exec.workflow_type) }}
                </span>
              </td>
              <td class="table-cell" style="color: var(--color-text-tertiary)">
                {{ exec.trigger_source }}
              </td>
              <td class="table-cell" style="color: var(--color-text-tertiary)">
                {{ exec.plane_issue_id ?? "-" }}
              </td>
              <td class="table-cell">
                <span
                  class="inline-flex items-center gap-1 text-xs"
                  style="font-weight: 510"
                  :style="{ color: statusColor(exec.status) }"
                >
                  <span
                    class="w-1.5 h-1.5 rounded-full"
                    :style="{ backgroundColor: statusColor(exec.status) }"
                  />
                  {{ statusLabelMap(exec.status) }}
                </span>
              </td>
              <td class="table-cell" style="color: var(--color-text-quaternary)">
                {{ exec.started_at ?? "-" }}
              </td>
              <td class="table-cell" style="color: var(--color-text-quaternary)">
                {{ exec.completed_at ?? "-" }}
              </td>
            </tr>
            <tr v-if="store.executions.length === 0">
              <td
                colspan="7"
                class="table-cell text-center py-10"
                style="color: var(--color-text-quaternary)"
              >
                暂无数据
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="mt-3 text-xs" style="color: var(--color-text-quaternary)">
        共 {{ store.total }} 条记录
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useWorkflowStore } from "@/stores/workflow";
import { typeLabel } from "@/utils/workflow";

defineOptions({ name: "WorkflowList" });

const store = useWorkflowStore();
const filterType = ref("");
const filterStatus = ref("");

const typeOptions = [
  { value: "", label: "全部" },
  { value: "prd_to_tech", label: "PRD → 技术文档" },
  { value: "tech_to_openapi", label: "技术文档 → OpenAPI" },
  { value: "bug_analysis", label: "Bug 分析" },
  { value: "code_gen", label: "代码生成" },
];

const statusOptions = [
  { value: "", label: "全部" },
  { value: "pending", label: "待执行" },
  { value: "running", label: "运行中" },
  { value: "success", label: "成功" },
  { value: "failed", label: "失败" },
];

function statusColor(status: string) {
  const map: Record<string, string> = {
    pending: "var(--color-text-quaternary)",
    running: "var(--color-accent-violet)",
    success: "var(--color-success)",
    failed: "var(--color-error)",
  };
  return map[status] ?? "var(--color-text-quaternary)";
}

function statusLabelMap(status: string) {
  const map: Record<string, string> = {
    pending: "待执行",
    running: "运行中",
    success: "成功",
    failed: "失败",
  };
  return map[status] ?? status;
}

function loadData() {
  store.loadExecutions({
    workflow_type: filterType.value || undefined,
    status: filterStatus.value || undefined,
  });
}

onMounted(() => loadData());
</script>

<style scoped>
.filter-pill {
  padding: 3px 10px;
  font-size: 12px;
  font-weight: 510;
  border-radius: 9999px;
  border: none;
  cursor: pointer;
  color: var(--color-text-tertiary);
  background: transparent;
  transition: all 120ms ease;
}

.filter-pill:hover {
  color: var(--color-text-secondary);
}

.filter-pill.active {
  background-color: var(--color-surface-08);
  color: var(--color-text-primary);
}

.table-header {
  padding: 8px 12px;
  text-align: left;
  font-size: 12px;
  font-weight: 510;
  color: var(--color-text-quaternary);
  text-transform: uppercase;
}

.table-row {
  border-bottom: 1px solid var(--color-border-subtle);
  transition: all 120ms ease;
}

.table-row:hover {
  background-color: var(--color-surface-04);
}

.table-row:last-child {
  border-bottom: none;
}

.table-cell {
  padding: 8px 12px;
  font-size: 13px;
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
