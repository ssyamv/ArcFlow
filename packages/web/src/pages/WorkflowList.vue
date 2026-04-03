<template>
  <div>
    <h1>工作流执行记录</h1>

    <div class="filters">
      <select v-model="filterType" @change="loadData">
        <option value="">全部类型</option>
        <option value="prd_to_tech">PRD → 技术文档</option>
        <option value="tech_to_openapi">技术文档 → OpenAPI</option>
        <option value="bug_analysis">Bug 分析</option>
        <option value="code_gen">代码生成</option>
      </select>

      <select v-model="filterStatus" @change="loadData">
        <option value="">全部状态</option>
        <option value="pending">Pending</option>
        <option value="running">Running</option>
        <option value="success">Success</option>
        <option value="failed">Failed</option>
      </select>
    </div>

    <div v-if="store.loading" class="loading">加载中...</div>

    <table v-else class="exec-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>类型</th>
          <th>触发来源</th>
          <th>Issue</th>
          <th>状态</th>
          <th>开始时间</th>
          <th>完成时间</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="exec in store.executions" :key="exec.id">
          <td>{{ exec.id }}</td>
          <td>{{ typeLabel(exec.workflow_type) }}</td>
          <td>{{ exec.trigger_source }}</td>
          <td>{{ exec.plane_issue_id ?? "-" }}</td>
          <td>
            <span :class="'status-' + exec.status">{{ exec.status }}</span>
          </td>
          <td>{{ exec.started_at ?? "-" }}</td>
          <td>{{ exec.completed_at ?? "-" }}</td>
        </tr>
        <tr v-if="store.executions.length === 0">
          <td colspan="7" class="empty">暂无数据</td>
        </tr>
      </tbody>
    </table>

    <p class="total">共 {{ store.total }} 条记录</p>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useWorkflowStore } from "../stores/workflow";

const store = useWorkflowStore();
const filterType = ref("");
const filterStatus = ref("");

function typeLabel(type: string): string {
  const labels: Record<string, string> = {
    prd_to_tech: "PRD → 技术文档",
    tech_to_openapi: "技术文档 → OpenAPI",
    bug_analysis: "Bug 分析",
    code_gen: "代码生成",
  };
  return labels[type] ?? type;
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
.filters {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}

.filters select {
  padding: 6px 12px;
  border: 1px solid #ccc;
  border-radius: 4px;
}

.exec-table {
  width: 100%;
  border-collapse: collapse;
  background: #fff;
  border-radius: 8px;
  overflow: hidden;
}

.exec-table th,
.exec-table td {
  padding: 10px 14px;
  text-align: left;
  border-bottom: 1px solid #eee;
}

.exec-table th {
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
  padding: 40px;
}

.total {
  margin-top: 12px;
  color: #666;
  font-size: 14px;
}

.loading {
  text-align: center;
  padding: 40px;
  color: #999;
}
</style>
