<template>
  <div>
    <h1 class="text-2xl font-bold mb-6">系统概览</h1>

    <div class="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
      <div
        class="bg-white p-5 rounded-lg"
        :class="gatewayOk ? 'border-l-4 border-green-500' : 'border-l-4 border-red-500'"
      >
        <h3 class="m-0 mb-2 text-sm text-gray-500">Gateway 服务</h3>
        <p class="text-lg font-semibold m-0" :class="gatewayOk ? 'text-green-500' : 'text-red-500'">
          {{ gatewayOk ? "正常运行" : "连接失败" }}
        </p>
        <p v-if="gatewayVersion" class="mt-1 text-gray-400 text-sm m-0">v{{ gatewayVersion }}</p>
      </div>
      <div class="bg-white p-5 rounded-lg border-l-4 border-gray-300">
        <h3 class="m-0 mb-2 text-sm text-gray-500">工作流总数</h3>
        <p class="text-3xl font-bold text-gray-800 m-0">{{ stats.total }}</p>
      </div>
      <div class="bg-white p-5 rounded-lg border-l-4 border-blue-500">
        <h3 class="m-0 mb-2 text-sm text-gray-500">运行中</h3>
        <p class="text-3xl font-bold text-gray-800 m-0">{{ stats.running }}</p>
      </div>
      <div class="bg-white p-5 rounded-lg border-l-4 border-green-500">
        <h3 class="m-0 mb-2 text-sm text-gray-500">成功</h3>
        <p class="text-3xl font-bold text-gray-800 m-0">{{ stats.success }}</p>
      </div>
      <div class="bg-white p-5 rounded-lg border-l-4 border-red-500">
        <h3 class="m-0 mb-2 text-sm text-gray-500">失败</h3>
        <p class="text-3xl font-bold text-gray-800 m-0">{{ stats.failed }}</p>
      </div>
    </div>

    <h2 class="text-xl font-semibold mb-4">最近执行</h2>
    <div class="bg-white rounded-lg overflow-hidden">
      <table class="w-full border-collapse">
        <thead>
          <tr class="bg-gray-50">
            <th class="px-4 py-2.5 text-left font-semibold">ID</th>
            <th class="px-4 py-2.5 text-left font-semibold">类型</th>
            <th class="px-4 py-2.5 text-left font-semibold">状态</th>
            <th class="px-4 py-2.5 text-left font-semibold">Issue</th>
            <th class="px-4 py-2.5 text-left font-semibold">时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="exec in recentExecutions" :key="exec.id" class="border-t border-gray-100">
            <td class="px-4 py-2.5">{{ exec.id }}</td>
            <td class="px-4 py-2.5">{{ typeLabel(exec.workflow_type) }}</td>
            <td class="px-4 py-2.5">
              <span :class="statusColors[exec.status] ?? 'text-gray-400'">{{ exec.status }}</span>
            </td>
            <td class="px-4 py-2.5">{{ exec.plane_issue_id ?? "-" }}</td>
            <td class="px-4 py-2.5">{{ exec.created_at }}</td>
          </tr>
          <tr v-if="recentExecutions.length === 0">
            <td colspan="5" class="text-center text-gray-400 py-8">暂无执行记录</td>
          </tr>
        </tbody>
      </table>
    </div>

    <p class="mt-3 text-gray-400 text-xs">每 10 秒自动刷新</p>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref } from "vue";
import { checkHealth, fetchExecutions, fetchVersion } from "@/api/workflow";
import { typeLabel, statusColors } from "@/utils/workflow";

defineOptions({ name: "SystemDashboard" });

interface Execution {
  id: number | string;
  workflow_type: string;
  status: string;
  plane_issue_id?: string | null;
  created_at: string;
}

const gatewayOk = ref(false);
const gatewayVersion = ref("");
const recentExecutions = ref<Execution[]>([]);
const stats = reactive({ total: 0, running: 0, success: 0, failed: 0 });

let timer: ReturnType<typeof setInterval> | null = null;

async function refresh() {
  try {
    const health = await checkHealth();
    gatewayOk.value = health.status === "ok";
  } catch {
    gatewayOk.value = false;
  }

  try {
    const data = await fetchVersion();
    gatewayVersion.value = data.version ?? "";
  } catch {
    gatewayVersion.value = "";
  }

  try {
    const all = await fetchExecutions({ limit: 100 });
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
