<template>
  <div>
    <h1
      class="text-2xl mb-6"
      style="font-weight: 510; color: var(--color-text-primary); letter-spacing: -0.288px"
    >
      手动触发工作流
    </h1>

    <form
      class="max-w-lg rounded-lg p-6"
      style="
        background-color: var(--color-surface-02);
        border: 1px solid var(--color-border-default);
      "
      @submit.prevent="handleSubmit"
    >
      <!-- Workflow Type -->
      <div class="mb-5">
        <label class="form-label">工作流类型</label>
        <div class="select-wrapper">
          <select v-model="form.workflow_type" required class="form-select">
            <option value="">请选择</option>
            <option value="prd_to_tech">PRD → 技术文档</option>
            <option value="tech_to_openapi">技术文档 → OpenAPI</option>
            <option value="bug_analysis">Bug 分析</option>
            <option value="code_gen">代码生成</option>
          </select>
          <span class="select-chevron">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path
                d="M3 4.5L6 7.5L9 4.5"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </span>
        </div>
      </div>

      <!-- Plane Issue ID -->
      <div class="mb-5">
        <label class="form-label">Plane Issue ID</label>
        <input
          v-model="form.plane_issue_id"
          type="text"
          placeholder="ISSUE-123"
          required
          class="form-input"
        />
      </div>

      <!-- Input Path -->
      <div class="mb-5">
        <label class="form-label">输入文件路径（可选）</label>
        <input
          v-model="form.input_path"
          type="text"
          placeholder="/prd/2026-04/feature-xxx.md"
          class="form-input"
        />
      </div>

      <!-- Code Gen Options -->
      <template v-if="form.workflow_type === 'code_gen'">
        <div class="mb-5">
          <label class="form-label">目标仓库</label>
          <div class="flex flex-wrap gap-3 mt-1">
            <label v-for="repo in availableRepos" :key="repo" class="checkbox-label">
              <span class="checkbox-box" :class="{ checked: form.target_repos.includes(repo) }">
                <svg
                  v-if="form.target_repos.includes(repo)"
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  fill="none"
                >
                  <path
                    d="M2 5L4 7L8 3"
                    stroke="white"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </span>
              <input v-model="form.target_repos" type="checkbox" :value="repo" class="sr-only" />
              <span class="text-sm" style="color: var(--color-text-secondary)">{{ repo }}</span>
            </label>
          </div>
          <p class="text-xs mt-1.5" style="color: var(--color-text-quaternary)">
            不选则默认 backend
          </p>
        </div>

        <div class="mb-5">
          <label class="form-label">Figma 设计稿链接（可选）</label>
          <input
            v-model="form.figma_url"
            type="url"
            placeholder="https://www.figma.com/design/..."
            class="form-input"
          />
        </div>
      </template>

      <!-- Submit -->
      <button type="submit" :disabled="submitting" class="submit-btn">
        {{ submitting ? "提交中..." : "触发工作流" }}
      </button>

      <!-- Error Message -->
      <div
        v-if="errorMessage"
        class="mt-4 p-3 rounded-md text-sm"
        style="
          background-color: rgba(239, 68, 68, 0.08);
          border: 1px solid rgba(239, 68, 68, 0.2);
          color: var(--color-error-light);
        "
      >
        {{ errorMessage }}
      </div>

      <!-- Success Message -->
      <div
        v-if="result"
        class="mt-4 p-3 rounded-md text-sm"
        style="
          background-color: rgba(52, 211, 153, 0.08);
          border: 1px solid rgba(52, 211, 153, 0.2);
          color: var(--color-success);
        "
      >
        工作流已触发，执行 ID: <strong>{{ result.execution_id }}</strong>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from "vue";
import { useWorkflowStore } from "@/stores/workflow";

defineOptions({ name: "WorkflowTrigger" });

const store = useWorkflowStore();
const submitting = ref(false);
const result = ref<{ execution_id: number } | null>(null);
const errorMessage = ref("");

const availableRepos = ["backend", "vue3", "flutter", "android"];

const form = reactive({
  workflow_type: "",
  plane_issue_id: "",
  input_path: "",
  target_repos: [] as string[],
  figma_url: "",
});

function resetForm() {
  form.workflow_type = "";
  form.plane_issue_id = "";
  form.input_path = "";
  form.target_repos = [];
  form.figma_url = "";
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
      target_repos: form.target_repos.length > 0 ? form.target_repos : undefined,
      figma_url: form.figma_url || undefined,
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

<style scoped>
.form-label {
  display: block;
  font-size: 13px;
  font-weight: 510;
  color: var(--color-text-secondary);
  margin-bottom: 6px;
}

.form-input {
  width: 100%;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--color-text-secondary);
  background-color: var(--color-surface-02);
  border: 1px solid var(--color-border-default);
  border-radius: 6px;
  outline: none;
  transition: border-color 120ms ease;
}

.form-input::placeholder {
  color: var(--color-text-quaternary);
}

.form-input:focus {
  border-color: var(--color-accent);
}

.select-wrapper {
  position: relative;
}

.form-select {
  width: 100%;
  padding: 8px 32px 8px 12px;
  font-size: 13px;
  color: var(--color-text-secondary);
  background-color: var(--color-bg-surface);
  border: 1px solid var(--color-border-default);
  border-radius: 6px;
  outline: none;
  appearance: none;
  cursor: pointer;
  transition: border-color 120ms ease;
}

.form-select:focus {
  border-color: var(--color-accent);
}

.select-chevron {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--color-text-quaternary);
  pointer-events: none;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.checkbox-box {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  border: 1px solid var(--color-border-default);
  background-color: var(--color-surface-02);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 120ms ease;
}

.checkbox-box.checked {
  background-color: var(--color-accent);
  border-color: var(--color-accent);
}

.submit-btn {
  padding: 8px 20px;
  font-size: 13px;
  font-weight: 510;
  color: white;
  background-color: var(--color-accent);
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: opacity 120ms ease;
}

.submit-btn:hover {
  opacity: 0.9;
}

.submit-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
