<template>
  <div>
    <h1 class="text-2xl font-bold mb-6">工作流执行记录</h1>

    <div class="flex gap-3 mb-4">
      <select
        v-model="filterType"
        class="px-3 py-1.5 border border-gray-300 rounded"
        @change="loadData"
      >
        <option value="">全部类型</option>
        <option value="prd_to_tech">PRD → 技术文档</option>
        <option value="tech_to_openapi">技术文档 → OpenAPI</option>
        <option value="bug_analysis">Bug 分析</option>
        <option value="code_gen">代码生成</option>
      </select>

      <select
        v-model="filterStatus"
        class="px-3 py-1.5 border border-gray-300 rounded"
        @change="loadData"
      >
        <option value="">全部状态</option>
        <option value="pending">Pending</option>
        <option value="running">Running</option>
        <option value="success">Success</option>
        <option value="failed">Failed</option>
      </select>
    </div>

    <div
      v-if="store.error"
      class="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm"
    >
      {{ store.error }}
    </div>

    <div v-if="store.loading" class="text-center py-10 text-gray-400">加载中...</div>

    <div v-else class="bg-white rounded-lg overflow-hidden">
      <table class="w-full border-collapse">
        <thead>
          <tr class="bg-gray-50">
            <th class="px-4 py-2.5 text-left font-semibold">ID</th>
            <th class="px-4 py-2.5 text-left font-semibold">类型</th>
            <th class="px-4 py-2.5 text-left font-semibold">触发来源</th>
            <th class="px-4 py-2.5 text-left font-semibold">Issue</th>
            <th class="px-4 py-2.5 text-left font-semibold">状态</th>
            <th class="px-4 py-2.5 text-left font-semibold">开始时间</th>
            <th class="px-4 py-2.5 text-left font-semibold">完成时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="exec in store.executions" :key="exec.id" class="border-t border-gray-100">
            <td class="px-4 py-2.5">{{ exec.id }}</td>
            <td class="px-4 py-2.5">{{ typeLabel(exec.workflow_type) }}</td>
            <td class="px-4 py-2.5">{{ exec.trigger_source }}</td>
            <td class="px-4 py-2.5">{{ exec.plane_issue_id ?? "-" }}</td>
            <td class="px-4 py-2.5">
              <span :class="statusColors[exec.status] ?? 'text-gray-400'">{{ exec.status }}</span>
            </td>
            <td class="px-4 py-2.5">{{ exec.started_at ?? "-" }}</td>
            <td class="px-4 py-2.5">{{ exec.completed_at ?? "-" }}</td>
          </tr>
          <tr v-if="store.executions.length === 0">
            <td colspan="7" class="text-center text-gray-400 py-10">暂无数据</td>
          </tr>
        </tbody>
      </table>
    </div>

    <p class="mt-3 text-gray-500 text-sm">共 {{ store.total }} 条记录</p>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useWorkflowStore } from "@/stores/workflow";
import { typeLabel, statusColors } from "@/utils/workflow";

const store = useWorkflowStore();
const filterType = ref("");
const filterStatus = ref("");

function loadData() {
  store.loadExecutions({
    workflow_type: filterType.value || undefined,
    status: filterStatus.value || undefined,
  });
}

onMounted(() => loadData());
</script>
