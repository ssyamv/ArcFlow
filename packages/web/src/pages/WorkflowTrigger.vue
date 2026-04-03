<template>
  <div>
    <h1>手动触发工作流</h1>

    <form class="trigger-form" @submit.prevent="handleSubmit">
      <div class="form-group">
        <label>工作流类型</label>
        <select v-model="form.workflow_type" required>
          <option value="">请选择</option>
          <option value="prd_to_tech">PRD → 技术文档</option>
          <option value="tech_to_openapi">技术文档 → OpenAPI</option>
          <option value="bug_analysis">Bug 分析</option>
          <option value="code_gen">代码生成</option>
        </select>
      </div>

      <div class="form-group">
        <label>Plane Issue ID</label>
        <input v-model="form.plane_issue_id" type="text" placeholder="ISSUE-123" required />
      </div>

      <div class="form-group">
        <label>输入文件路径（可选）</label>
        <input v-model="form.input_path" type="text" placeholder="/prd/2026-04/feature-xxx.md" />
      </div>

      <button type="submit" :disabled="submitting">
        {{ submitting ? "提交中..." : "触发工作流" }}
      </button>

      <div v-if="result" class="result">
        <p>
          工作流已触发，执行 ID: <strong>{{ result.execution_id }}</strong>
        </p>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from "vue";
import { useWorkflowStore } from "../stores/workflow";

const store = useWorkflowStore();
const submitting = ref(false);
const result = ref<{ execution_id: number } | null>(null);

const form = reactive({
  workflow_type: "",
  plane_issue_id: "",
  input_path: "",
});

async function handleSubmit() {
  submitting.value = true;
  result.value = null;
  try {
    const res = await store.trigger({
      workflow_type: form.workflow_type,
      plane_issue_id: form.plane_issue_id,
      input_path: form.input_path || undefined,
    });
    result.value = res;
  } finally {
    submitting.value = false;
  }
}
</script>

<style scoped>
.trigger-form {
  max-width: 500px;
  background: #fff;
  padding: 24px;
  border-radius: 8px;
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  margin-bottom: 6px;
  font-weight: 500;
}

.form-group input,
.form-group select {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #ccc;
  border-radius: 4px;
  box-sizing: border-box;
}

button {
  padding: 10px 24px;
  background: #1890ff;
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

button:disabled {
  background: #ccc;
  cursor: not-allowed;
}

.result {
  margin-top: 16px;
  padding: 12px;
  background: #f6ffed;
  border: 1px solid #b7eb8f;
  border-radius: 4px;
}
</style>
