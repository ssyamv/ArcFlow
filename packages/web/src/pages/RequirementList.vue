<template>
  <div>
    <!-- 顶部操作栏 -->
    <div class="flex items-center justify-between mb-6">
      <h1
        class="text-2xl"
        style="font-weight: 510; color: var(--color-text-primary); letter-spacing: -0.288px"
      >
        需求草稿
      </h1>
      <button
        class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm text-white cursor-pointer"
        style="background-color: var(--color-accent); border: none; font-weight: 510"
        @click="$router.push('/requirements/new')"
      >
        <Plus :size="14" />
        新建需求
      </button>
    </div>

    <!-- 状态过滤 -->
    <div class="flex flex-wrap gap-2 mb-5">
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
        @click="setFilter(s.value)"
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
              <th class="table-header">标题</th>
              <th class="table-header">状态</th>
              <th class="table-header">更新时间</th>
              <th class="table-header">创建时间</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="draft in store.drafts.data"
              :key="draft.id"
              class="table-row cursor-pointer"
              @click="$router.push(`/requirements/${draft.id}`)"
            >
              <td class="table-cell">
                <span style="color: var(--color-text-primary); font-weight: 510">
                  {{ draft.issue_title || `草稿 #${draft.id}` }}
                </span>
              </td>
              <td class="table-cell">
                <span
                  class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
                  :style="statusBadgeStyle(draft.status)"
                >
                  {{ statusLabel(draft.status) }}
                </span>
              </td>
              <td class="table-cell" style="color: var(--color-text-quaternary)">
                {{ formatDate(draft.updated_at) }}
              </td>
              <td class="table-cell" style="color: var(--color-text-quaternary)">
                {{ formatDate(draft.created_at) }}
              </td>
            </tr>
            <tr v-if="store.drafts.data.length === 0">
              <td
                colspan="4"
                class="table-cell text-center py-10"
                style="color: var(--color-text-quaternary)"
              >
                暂无需求草稿，点击「新建需求」开始
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="mt-3 text-xs" style="color: var(--color-text-quaternary)">
        共 {{ store.drafts.total }} 条记录
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRequirementStore } from "../stores/requirement";
import { Plus } from "lucide-vue-next";
import type { RequirementDraftStatus } from "../api/requirement";

defineOptions({ name: "RequirementListPage" });

const store = useRequirementStore();
const filterStatus = ref("");

const statusOptions = [
  { value: "", label: "全部" },
  { value: "drafting", label: "草稿中" },
  { value: "review", label: "待 Review" },
  { value: "approved", label: "已通过" },
  { value: "rejected", label: "已拒绝" },
];

function statusLabel(status: RequirementDraftStatus | string) {
  const map: Record<string, string> = {
    drafting: "草稿中",
    review: "待 Review",
    approved: "已通过",
    rejected: "已拒绝",
    abandoned: "已放弃",
  };
  return map[status] ?? status;
}

function statusBadgeStyle(status: string) {
  if (status === "drafting")
    return "background-color: rgba(94,106,210,0.12); color: var(--color-accent); font-weight: 510";
  if (status === "review")
    return "background-color: rgba(234,179,8,0.12); color: #ca8a04; font-weight: 510";
  if (status === "approved")
    return "background-color: rgba(34,197,94,0.12); color: var(--color-success); font-weight: 510";
  if (status === "rejected")
    return "background-color: rgba(239,68,68,0.08); color: var(--color-error); font-weight: 510";
  return "background-color: var(--color-surface-05); color: var(--color-text-quaternary); font-weight: 510";
}

function formatDate(dateStr: string) {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return "刚刚";
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  return d.toLocaleDateString("zh-CN");
}

function setFilter(status: string) {
  filterStatus.value = status;
  store.loadDrafts({ status: status || undefined });
}

onMounted(() => {
  store.loadDrafts();
});
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
  padding: 10px 12px;
  font-size: 13px;
  font-weight: 400;
  color: var(--color-text-secondary);
}
</style>
