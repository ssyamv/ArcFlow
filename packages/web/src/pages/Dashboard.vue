<template>
  <div>
    <h1>系统概览</h1>

    <div class="status-cards">
      <div class="card" :class="gatewayOk ? 'card-ok' : 'card-error'">
        <h3>Gateway 服务</h3>
        <p class="status-text">{{ gatewayOk ? "正常运行" : "连接失败" }}</p>
        <p v-if="gatewayVersion" class="version">v{{ gatewayVersion }}</p>
      </div>

      <div class="card">
        <h3>工作流总数</h3>
        <p class="stat-number">{{ stats.total }}</p>
      </div>

      <div class="card card-running">
        <h3>运行中</h3>
        <p class="stat-number">{{ stats.running }}</p>
      </div>

      <div class="card card-success">
        <h3>成功</h3>
        <p class="stat-number">{{ stats.success }}</p>
      </div>

      <div class="card card-failed">
        <h3>失败</h3>
        <p class="stat-number">{{ stats.failed }}</p>
      </div>
    </div>

    <h2>最近执行</h2>
    <table class="recent-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>类型</th>
          <th>状态</th>
          <th>Issue</th>
          <th>时间</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="exec in recentExecutions" :key="exec.id">
          <td>{{ exec.id }}</td>
          <td>{{ typeLabel(exec.workflow_type) }}</td>
          <td>
            <span :class="'status-' + exec.status">{{ exec.status }}</span>
          </td>
          <td>{{ exec.plane_issue_id ?? "-" }}</td>
          <td>{{ exec.created_at }}</td>
        </tr>
        <tr v-if="recentExecutions.length === 0">
          <td colspan="5" class="empty">暂无执行记录</td>
        </tr>
      </tbody>
    </table>

    <p class="refresh-hint">每 10 秒自动刷新</p>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref } from "vue";
import { checkHealth, fetchExecutions } from "../api/workflow";

defineOptions({ name: "SystemDashboard" });

interface Execution {
  id: number | string;
  workflow_type: string;
  status: string;
  plane_issue_id?: string | null;
  created_at: string;
}

interface ExecutionsResponse {
  total: number;
  data: Execution[];
}

const gatewayOk = ref(false);
const gatewayVersion = ref("");
const recentExecutions = ref<Execution[]>([]);
const stats = reactive({ total: 0, running: 0, success: 0, failed: 0 });

let timer: ReturnType<typeof setInterval> | null = null;

const typeLabels: Record<string, string> = {
  prd_to_tech: "PRD → 技术文档",
  tech_to_openapi: "技术文档 → OpenAPI",
  bug_analysis: "Bug 分析",
  code_gen: "代码生成",
};

function typeLabel(type: string): string {
  return typeLabels[type] ?? type;
}

async function refresh() {
  try {
    const health = (await checkHealth()) as { status: string };
    gatewayOk.value = health.status === "ok";
  } catch {
    gatewayOk.value = false;
  }

  try {
    const res = await fetch((import.meta.env.VITE_API_BASE ?? "") + "/version");
    const data = (await res.json()) as { version?: string };
    gatewayVersion.value = data.version ?? "";
  } catch {
    gatewayVersion.value = "";
  }

  try {
    const all = (await fetchExecutions({ limit: 100 })) as ExecutionsResponse;
    stats.total = all.total;
    stats.running = all.data.filter((e) => e.status === "running").length;
    stats.success = all.data.filter((e) => e.status === "success").length;
    stats.failed = all.data.filter((e) => e.status === "failed").length;
    recentExecutions.value = all.data.slice(0, 5);
  } catch {
    // ignore
  }
}

onMounted(() => {
  refresh();
  timer = setInterval(refresh, 10000);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<style scoped>
.status-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 16px;
  margin-bottom: 32px;
}

.card {
  background: #fff;
  padding: 20px;
  border-radius: 8px;
  border-left: 4px solid #d9d9d9;
}

.card h3 {
  margin: 0 0 8px;
  font-size: 14px;
  color: #666;
}

.card-ok {
  border-left-color: #52c41a;
}

.card-error {
  border-left-color: #f5222d;
}

.card-running {
  border-left-color: #1890ff;
}

.card-success {
  border-left-color: #52c41a;
}

.card-failed {
  border-left-color: #f5222d;
}

.status-text {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
}

.card-ok .status-text {
  color: #52c41a;
}

.card-error .status-text {
  color: #f5222d;
}

.version {
  margin: 4px 0 0;
  color: #999;
  font-size: 13px;
}

.stat-number {
  font-size: 28px;
  font-weight: 700;
  margin: 0;
  color: #333;
}

.recent-table {
  width: 100%;
  border-collapse: collapse;
  background: #fff;
  border-radius: 8px;
  overflow: hidden;
}

.recent-table th,
.recent-table td {
  padding: 10px 14px;
  text-align: left;
  border-bottom: 1px solid #eee;
}

.recent-table th {
  background: #f9f9f9;
  font-weight: 600;
}

.status-pending {
  color: #999;
}
.status-running {
  color: #1890ff;
}
.status-success {
  color: #52c41a;
}
.status-failed {
  color: #f5222d;
}

.empty {
  text-align: center;
  color: #999;
  padding: 30px;
}

.refresh-hint {
  margin-top: 12px;
  color: #999;
  font-size: 12px;
}
</style>
