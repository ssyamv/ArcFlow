<template>
  <div>
    <h1 class="text-2xl font-bold mb-6">手动触发工作流</h1>

    <form class="max-w-lg bg-white p-6 rounded-lg" @submit.prevent="handleSubmit">
      <div class="mb-4">
        <label class="block mb-1.5 font-medium text-sm">工作流类型</label>
        <select
          v-model="form.workflow_type"
          required
          class="w-full px-3 py-2 border border-gray-300 rounded"
        >
          <option value="">请选择</option>
          <option value="prd_to_tech">PRD → 技术文档</option>
          <option value="tech_to_openapi">技术文档 → OpenAPI</option>
          <option value="bug_analysis">Bug 分析</option>
          <option value="code_gen">代码生成</option>
        </select>
      </div>

      <div class="mb-4">
        <label class="block mb-1.5 font-medium text-sm">Plane Issue ID</label>
        <input
          v-model="form.plane_issue_id"
          type="text"
          placeholder="ISSUE-123"
          required
          class="w-full px-3 py-2 border border-gray-300 rounded"
        />
      </div>

      <div class="mb-4">
        <label class="block mb-1.5 font-medium text-sm">输入文件路径（可选）</label>
        <input
          v-model="form.input_path"
          type="text"
          placeholder="/prd/2026-04/feature-xxx.md"
          class="w-full px-3 py-2 border border-gray-300 rounded"
        />
      </div>

      <button
        type="submit"
        :disabled="submitting"
        class="px-6 py-2.5 bg-blue-500 text-white rounded font-medium hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
      >
        {{ submitting ? "提交中..." : "触发工作流" }}
      </button>

      <div
        v-if="errorMessage"
        class="mt-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm"
      >
        {{ errorMessage }}
      </div>

      <div
        v-if="result"
        class="mt-4 p-3 bg-green-50 border border-green-200 rounded text-green-700 text-sm"
      >
        工作流已触发，执行 ID: <strong>{{ result.execution_id }}</strong>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from "vue";
import { useWorkflowStore } from "@/stores/workflow";

const store = useWorkflowStore();
const submitting = ref(false);
const result = ref<{ execution_id: number } | null>(null);
const errorMessage = ref("");

const form = reactive({
  workflow_type: "",
  plane_issue_id: "",
  input_path: "",
});

function resetForm() {
  form.workflow_type = "";
  form.plane_issue_id = "";
  form.input_path = "";
}

async function handleSubmit() {
  submitting.value = true;
  result.value = null;
  errorMessage.value = "";
  try {
    const res = await store.trigger({
      workflow_type: form.workflow_type,
      plane_issue_id: form.plane_issue_id,
      input_path: form.input_path || undefined,
    });
    result.value = res;
    resetForm();
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : "触发失败";
  } finally {
    submitting.value = false;
  }
}
</script>
