<template>
  <div>
    <h1
      class="text-2xl mb-6"
      style="font-weight: 510; color: var(--color-text-primary); letter-spacing: -0.288px"
    >
      系统概览
    </h1>

    <!-- KPI Cards -->
    <div class="grid grid-cols-4 gap-4 mb-8">
      <div
        v-for="kpi in kpis"
        :key="kpi.label"
        class="p-4 rounded-lg"
        style="
          background-color: var(--color-surface-02);
          border: 1px solid var(--color-border-default);
        "
      >
        <div class="text-xs mb-1" style="font-weight: 510; color: var(--color-text-tertiary)">
          {{ kpi.label }}
        </div>
        <div
          class="text-2xl"
          style="font-weight: 510; color: var(--color-text-primary); letter-spacing: -0.288px"
        >
          {{ kpi.value }}
        </div>
      </div>
    </div>

    <!-- Gateway Status -->
    <div class="flex items-center gap-2 mb-6">
      <div
        class="w-2 h-2 rounded-full"
        :style="{ backgroundColor: gatewayOk ? 'var(--color-success)' : 'var(--color-error)' }"
      />
      <span class="text-xs" style="font-weight: 510; color: var(--color-text-tertiary)">
        Gateway {{ gatewayOk ? "在线" : "离线" }}
        <span v-if="gatewayVersion" style="color: var(--color-text-quaternary)">
          v{{ gatewayVersion }}
        </span>
      </span>
    </div>

    <!-- Recent Executions Table -->
    <div>
      <h2
        class="text-xs uppercase mb-3"
        style="font-weight: 510; color: var(--color-text-quaternary); letter-spacing: 0.05em"
      >
        最近执行
      </h2>
      <div class="rounded-lg overflow-hidden" style="border: 1px solid var(--color-border-default)">
        <table class="w-full">
          <thead>
            <tr style="border-bottom: 1px solid var(--color-border-subtle)">
              <th class="table-header">ID</th>
              <th class="table-header">类型</th>
              <th class="table-header">触发</th>
              <th class="table-header">状态</th>
              <th class="table-header">时间</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="exec in store.executions.slice(0, 5)"
              :key="exec.id"
              class="table-row cursor-pointer"
              @click="$router.push(`/workflows/${exec.id}`)"
            >
              <td class="table-cell" style="color: var(--color-text-tertiary)">#{{ exec.id }}</td>
              <td class="table-cell">
                <span class="status-pill" style="border-color: var(--color-border-solid)">
                  {{ workflowLabel(exec.workflow_type) }}
                </span>
              </td>
              <td class="table-cell" style="color: var(--color-text-tertiary)">
                {{ exec.trigger_source }}
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
                  {{ statusLabel(exec.status) }}
                </span>
              </td>
              <td class="table-cell" style="color: var(--color-text-quaternary)">
                {{ exec.created_at }}
              </td>
            </tr>
            <tr v-if="store.executions.length === 0">
              <td
                colspan="5"
                class="table-cell text-center"
                style="color: var(--color-text-quaternary)"
              >
                暂无执行记录
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useWorkflowStore } from "../stores/workflow";
import { checkHealth, fetchVersion } from "../api/workflow";

defineOptions({ name: "SystemDashboard" });

const store = useWorkflowStore();
const gatewayOk = ref(false);
const gatewayVersion = ref("");

const kpis = computed(() => {
  const execs = store.executions;
  return [
    { label: "总执行", value: store.total },
    { label: "运行中", value: execs.filter((e) => e.status === "running").length },
    { label: "成功", value: execs.filter((e) => e.status === "success").length },
    { label: "失败", value: execs.filter((e) => e.status === "failed").length },
  ];
});

function workflowLabel(type: string) {
  const map: Record<string, string> = {
    prd_to_tech: "PRD → 技术文档",
    tech_to_openapi: "技术文档 → OpenAPI",
    bug_analysis: "Bug 分析",
    code_gen: "代码生成",
  };
  return map[type] ?? type;
}

function statusColor(status: string) {
  const map: Record<string, string> = {
    pending: "var(--color-text-quaternary)",
    running: "var(--color-accent-violet)",
    success: "var(--color-success)",
    failed: "var(--color-error)",
  };
  return map[status] ?? "var(--color-text-quaternary)";
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    pending: "待执行",
    running: "运行中",
    success: "成功",
    failed: "失败",
  };
  return map[status] ?? status;
}

let timer: ReturnType<typeof setInterval>;

onMounted(async () => {
  await store.loadExecutions({ limit: 20 });
  checkHealth()
    .then(() => {
      gatewayOk.value = true;
    })
    .catch(() => {
      gatewayOk.value = false;
    });
  fetchVersion()
    .then((v) => {
      gatewayVersion.value = v.version;
    })
    .catch(() => {});
  timer = setInterval(() => store.loadExecutions({ limit: 20 }), 10000);
});

onUnmounted(() => clearInterval(timer));
</script>

<style scoped>
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
