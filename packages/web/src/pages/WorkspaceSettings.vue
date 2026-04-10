<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-lg m-0" style="font-weight: 510; color: var(--color-text-primary)">
        工作空间设置
      </h1>
      <p class="mt-1 text-xs" style="color: var(--color-text-tertiary)">
        管理当前工作空间的配置和成员
      </p>
    </div>

    <div v-if="loading" class="py-12 text-center text-sm" style="color: var(--color-text-tertiary)">
      加载中...
    </div>

    <template v-else-if="detail">
      <!-- Basic Info -->
      <section class="rounded-xl p-5" style="background-color: var(--color-surface-02)">
        <h3
          class="text-xs uppercase tracking-wider m-0 mb-4"
          style="color: var(--color-text-quaternary); font-weight: 600"
        >
          基本信息
        </h3>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-xs mb-1" style="color: var(--color-text-tertiary)">名称</label>
            <div class="text-sm" style="color: var(--color-text-primary)">{{ detail.name }}</div>
          </div>
          <div>
            <label class="block text-xs mb-1" style="color: var(--color-text-tertiary)">Slug</label>
            <div class="text-sm" style="color: var(--color-text-primary)">{{ detail.slug }}</div>
          </div>
          <div>
            <label class="block text-xs mb-1" style="color: var(--color-text-tertiary)">
              Plane 项目
            </label>
            <div class="relative">
              <select
                v-model="form.plane_project_id"
                class="w-full px-3 py-2 rounded-lg text-sm appearance-none cursor-pointer"
                style="
                  background-color: var(--color-bg-primary);
                  border: 1px solid var(--color-border-default);
                  color: var(--color-text-primary);
                  outline: none;
                "
              >
                <option value="">未关联</option>
                <option v-for="p in planeProjects" :key="p.id" :value="p.id">
                  {{ p.identifier }} — {{ p.name }}
                </option>
              </select>
            </div>
          </div>
          <div>
            <label class="block text-xs mb-1" style="color: var(--color-text-tertiary)"
              >你的角色</label
            >
            <div class="text-sm" style="color: var(--color-text-primary)">
              {{ detail.user_role }}
            </div>
          </div>
        </div>
      </section>

      <!-- Knowledge Base Config -->
      <section class="rounded-xl p-5" style="background-color: var(--color-surface-02)">
        <h3
          class="text-xs uppercase tracking-wider m-0 mb-4"
          style="color: var(--color-text-quaternary); font-weight: 600"
        >
          知识库配置
        </h3>
        <div class="space-y-4">
          <div>
            <label class="block text-xs mb-1.5" style="color: var(--color-text-tertiary)"
              >Dify Dataset ID</label
            >
            <input
              v-model="form.dify_dataset_id"
              type="text"
              class="w-full px-3 py-2 rounded-lg text-sm"
              style="
                background-color: var(--color-bg-primary);
                border: 1px solid var(--color-border-default);
                color: var(--color-text-primary);
                outline: none;
              "
              placeholder="输入 Dify 数据集 ID"
            />
          </div>
          <div>
            <label class="block text-xs mb-1.5" style="color: var(--color-text-tertiary)"
              >Dify RAG API Key</label
            >
            <input
              v-model="form.dify_rag_api_key"
              type="password"
              class="w-full px-3 py-2 rounded-lg text-sm"
              style="
                background-color: var(--color-bg-primary);
                border: 1px solid var(--color-border-default);
                color: var(--color-text-primary);
                outline: none;
              "
              placeholder="输入 Dify RAG API Key"
            />
          </div>
          <div>
            <label class="block text-xs mb-1.5" style="color: var(--color-text-tertiary)"
              >Wiki 路径前缀</label
            >
            <input
              v-model="form.wiki_path_prefix"
              type="text"
              class="w-full px-3 py-2 rounded-lg text-sm"
              style="
                background-color: var(--color-bg-primary);
                border: 1px solid var(--color-border-default);
                color: var(--color-text-primary);
                outline: none;
              "
              placeholder="例如: /projects/my-project"
            />
          </div>
        </div>
      </section>

      <!-- Git Repos -->
      <section class="rounded-xl p-5" style="background-color: var(--color-surface-02)">
        <h3
          class="text-xs uppercase tracking-wider m-0 mb-4"
          style="color: var(--color-text-quaternary); font-weight: 600"
        >
          Git 仓库
        </h3>
        <div class="space-y-4">
          <div>
            <label class="block text-xs mb-1.5" style="color: var(--color-text-tertiary)"
              >后端仓库</label
            >
            <input
              v-model="gitRepos.backend"
              type="text"
              class="w-full px-3 py-2 rounded-lg text-sm"
              style="
                background-color: var(--color-bg-primary);
                border: 1px solid var(--color-border-default);
                color: var(--color-text-primary);
                outline: none;
              "
              placeholder="https://github.com/org/backend.git"
            />
          </div>
          <div>
            <label class="block text-xs mb-1.5" style="color: var(--color-text-tertiary)"
              >Vue3 前端仓库</label
            >
            <input
              v-model="gitRepos.vue3"
              type="text"
              class="w-full px-3 py-2 rounded-lg text-sm"
              style="
                background-color: var(--color-bg-primary);
                border: 1px solid var(--color-border-default);
                color: var(--color-text-primary);
                outline: none;
              "
              placeholder="https://github.com/org/web.git"
            />
          </div>
          <div>
            <label class="block text-xs mb-1.5" style="color: var(--color-text-tertiary)"
              >Flutter 仓库</label
            >
            <input
              v-model="gitRepos.flutter"
              type="text"
              class="w-full px-3 py-2 rounded-lg text-sm"
              style="
                background-color: var(--color-bg-primary);
                border: 1px solid var(--color-border-default);
                color: var(--color-text-primary);
                outline: none;
              "
              placeholder="https://github.com/org/flutter.git"
            />
          </div>
          <div>
            <label class="block text-xs mb-1.5" style="color: var(--color-text-tertiary)"
              >Android 仓库</label
            >
            <input
              v-model="gitRepos.android"
              type="text"
              class="w-full px-3 py-2 rounded-lg text-sm"
              style="
                background-color: var(--color-bg-primary);
                border: 1px solid var(--color-border-default);
                color: var(--color-text-primary);
                outline: none;
              "
              placeholder="https://github.com/org/android.git"
            />
          </div>
        </div>
      </section>

      <!-- Members -->
      <section class="rounded-xl p-5" style="background-color: var(--color-surface-02)">
        <h3
          class="text-xs uppercase tracking-wider m-0 mb-4"
          style="color: var(--color-text-quaternary); font-weight: 600"
        >
          成员 ({{ detail.members.length }})
        </h3>
        <div class="space-y-2">
          <div
            v-for="member in detail.members"
            :key="member.user_id"
            class="flex items-center justify-between py-2 px-3 rounded-lg"
            style="background-color: var(--color-bg-primary)"
          >
            <div class="text-sm" style="color: var(--color-text-primary)">{{ member.name }}</div>
            <span
              class="text-xs px-2 py-0.5 rounded-full"
              :style="{
                backgroundColor:
                  member.role === 'admin'
                    ? 'var(--color-accent-violet)'
                    : 'var(--color-surface-05)',
                color: member.role === 'admin' ? '#fff' : 'var(--color-text-secondary)',
              }"
            >
              {{ member.role }}
            </span>
          </div>
          <div
            v-if="detail.members.length === 0"
            class="text-xs py-4 text-center"
            style="color: var(--color-text-quaternary)"
          >
            暂无成员
          </div>
        </div>
      </section>

      <!-- Save -->
      <div class="flex justify-end gap-3 pt-2">
        <button
          class="px-5 py-2 rounded-lg text-sm cursor-pointer"
          style="
            background-color: var(--color-accent-violet);
            color: #fff;
            border: none;
            font-weight: 510;
            transition: all 120ms ease;
          "
          :disabled="saving"
          @click="handleSave"
        >
          {{ saving ? "保存中..." : "保存设置" }}
        </button>
      </div>

      <!-- Status message -->
      <div
        v-if="statusMessage"
        class="text-xs px-3 py-2 rounded-lg text-right"
        :style="{
          color: statusError ? 'var(--color-status-error)' : 'var(--color-status-success)',
        }"
      >
        {{ statusMessage }}
      </div>
    </template>

    <div v-else class="py-12 text-center text-sm" style="color: var(--color-text-tertiary)">
      无法加载工作空间信息
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from "vue";
import { useWorkspaceStore } from "../stores/workspace";
import { updateWorkspaceSettings } from "../api/workspaces";
import { fetchPlaneProjects } from "../api/plane";
import type { PlaneProject } from "../api/plane";

const wsStore = useWorkspaceStore();
const loading = ref(false);
const saving = ref(false);
const statusMessage = ref("");
const statusError = ref(false);

const detail = ref(wsStore.currentDetail);

const planeProjects = ref<PlaneProject[]>([]);
const loadingProjects = ref(false);

async function loadPlaneProjects() {
  loadingProjects.value = true;
  try {
    planeProjects.value = await fetchPlaneProjects();
  } catch {
    // Plane 不可用时静默失败
  } finally {
    loadingProjects.value = false;
  }
}

const form = reactive({
  dify_dataset_id: "",
  dify_rag_api_key: "",
  wiki_path_prefix: "",
  plane_project_id: "",
});

const gitRepos = reactive({
  backend: "",
  vue3: "",
  flutter: "",
  android: "",
});

function loadForm() {
  if (!detail.value) return;
  form.dify_dataset_id = detail.value.dify_dataset_id ?? "";
  form.dify_rag_api_key = detail.value.dify_rag_api_key ?? "";
  form.wiki_path_prefix = detail.value.wiki_path_prefix ?? "";
  form.plane_project_id = detail.value.plane_project_id ?? "";

  try {
    const repos = JSON.parse(detail.value.git_repos || "{}");
    gitRepos.backend = repos.backend ?? "";
    gitRepos.vue3 = repos.vue3 ?? "";
    gitRepos.flutter = repos.flutter ?? "";
    gitRepos.android = repos.android ?? "";
  } catch {
    // ignore parse errors
  }
}

watch(
  () => wsStore.currentDetail,
  (val) => {
    detail.value = val;
    loadForm();
    loadPlaneProjects();
  },
  { immediate: true },
);

async function handleSave() {
  if (!detail.value) return;
  saving.value = true;
  statusMessage.value = "";
  try {
    await updateWorkspaceSettings(detail.value.id, {
      dify_dataset_id: form.dify_dataset_id || null,
      dify_rag_api_key: form.dify_rag_api_key || null,
      wiki_path_prefix: form.wiki_path_prefix || null,
      plane_project_id: form.plane_project_id || null,
      git_repos: JSON.stringify({
        backend: gitRepos.backend || undefined,
        vue3: gitRepos.vue3 || undefined,
        flutter: gitRepos.flutter || undefined,
        android: gitRepos.android || undefined,
      }),
    });
    statusMessage.value = "设置已保存";
    statusError.value = false;
    // Reload detail
    if (wsStore.currentId) {
      await wsStore.select(wsStore.currentId);
    }
  } catch {
    statusMessage.value = "保存失败，请重试";
    statusError.value = true;
  } finally {
    saving.value = false;
  }
}
</script>
