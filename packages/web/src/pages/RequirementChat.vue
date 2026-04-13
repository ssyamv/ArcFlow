<!-- eslint-disable vue/no-v-html -->
<template>
  <div class="flex" style="height: calc(100vh - 48px)">
    <!-- 左：对话区 -->
    <div
      class="flex flex-col min-w-0"
      style="flex: 1; border-right: 1px solid var(--color-border-subtle)"
    >
      <!-- 顶栏 -->
      <div
        class="px-4 py-2 flex items-center justify-between shrink-0"
        style="border-bottom: 1px solid var(--color-border-subtle)"
      >
        <div class="flex items-center gap-2">
          <button
            class="flex items-center gap-1.5 text-xs cursor-pointer"
            style="background: none; border: none; color: var(--color-text-quaternary)"
            @click="$router.push('/requirements')"
          >
            <ChevronLeft :size="14" />
            需求列表
          </button>
          <span style="color: var(--color-border-default)">·</span>
          <span class="text-xs" style="color: var(--color-text-tertiary); font-weight: 510">
            {{ store.currentDraft?.issue_title || "新需求草稿" }}
          </span>
        </div>
        <div class="flex items-center gap-2">
          <span
            class="text-xs px-2 py-0.5 rounded-full"
            :style="statusStyle(store.currentDraft?.status)"
          >
            {{ statusLabel(store.currentDraft?.status) }}
          </span>
          <!-- 提交审批按钮：仅 review 状态显示 -->
          <button
            v-if="store.currentDraft?.status === 'review'"
            class="px-3 py-1.5 rounded-md text-xs font-medium cursor-pointer"
            :disabled="store.loading"
            :style="{
              backgroundColor: store.loading ? 'var(--color-surface-05)' : 'var(--color-accent)',
              color: store.loading ? 'var(--color-text-quaternary)' : '#fff',
              border: 'none',
              cursor: store.loading ? 'not-allowed' : 'pointer',
            }"
            @click="handleApprove"
          >
            {{ store.loading ? "处理中..." : "提交审批" }}
          </button>
          <!-- 完成草稿按钮：仅 drafting 状态显示 -->
          <button
            v-else-if="store.currentDraft?.status === 'drafting'"
            class="px-3 py-1.5 rounded-md text-xs font-medium cursor-pointer"
            :disabled="!canFinalize"
            :style="{
              backgroundColor: canFinalize ? 'var(--color-accent)' : 'var(--color-surface-05)',
              color: canFinalize ? '#fff' : 'var(--color-text-quaternary)',
              border: 'none',
              cursor: canFinalize ? 'pointer' : 'not-allowed',
            }"
            @click="handleFinalize"
          >
            完成草稿
          </button>
        </div>
      </div>

      <!-- 消息列表 -->
      <div ref="msgContainer" class="flex-1 overflow-y-auto px-6 py-4">
        <!-- 空态提示 -->
        <div v-if="messages.length === 0" class="flex flex-col items-center justify-center h-full">
          <MessageSquare
            :size="40"
            style="color: var(--color-border-default); margin-bottom: 12px"
          />
          <p class="text-sm" style="color: var(--color-text-quaternary)">
            开始描述你的需求，AI 将帮你生成 PRD 草稿
          </p>
        </div>

        <div v-for="(msg, idx) in messages" :key="idx" class="mb-4">
          <div v-if="msg.role === 'user'" class="flex justify-end">
            <div
              class="max-w-lg px-3 py-2 rounded-lg text-sm"
              style="background-color: rgba(94, 106, 210, 0.15); color: var(--color-text-primary)"
            >
              {{ msg.content }}
            </div>
          </div>
          <div v-else class="flex gap-2">
            <div
              class="w-6 h-6 rounded-full shrink-0 flex items-center justify-center text-xs mt-0.5"
              style="background-color: var(--color-surface-05); color: var(--color-text-tertiary)"
            >
              AI
            </div>
            <!-- eslint-disable-next-line vue/no-v-html -->
            <div
              class="prose text-sm max-w-2xl flex-1"
              v-html="
                msg.content ? renderMd(msg.content) : '<span class=\'streaming-cursor\'>···</span>'
              "
            />
          </div>
        </div>

        <div
          v-if="store.streaming && messages[messages.length - 1]?.role === 'user'"
          class="flex gap-2 mb-4"
        >
          <div
            class="w-6 h-6 rounded-full shrink-0 flex items-center justify-center text-xs"
            style="background-color: var(--color-surface-05); color: var(--color-text-tertiary)"
          >
            AI
          </div>
          <span class="text-sm animate-pulse" style="color: var(--color-text-tertiary)">···</span>
        </div>
      </div>

      <!-- 输入框 -->
      <div class="px-6 pb-4 pt-2 shrink-0">
        <div
          v-if="store.error"
          class="mb-2 px-3 py-1.5 rounded-md text-xs"
          style="
            background-color: rgba(239, 68, 68, 0.08);
            border: 1px solid rgba(239, 68, 68, 0.2);
            color: var(--color-error-light);
          "
        >
          {{ store.error }}
        </div>
        <div
          class="flex items-end gap-2 p-3 rounded-lg"
          style="
            background-color: var(--color-surface-02);
            border: 1px solid var(--color-border-default);
          "
        >
          <textarea
            v-model="inputText"
            rows="1"
            placeholder="描述你的需求，Shift+Enter 换行，Enter 发送"
            class="flex-1 bg-transparent outline-none resize-none text-sm"
            style="color: var(--color-text-secondary); max-height: 144px"
            :disabled="store.streaming || isReadonly"
            @keydown.enter.exact.prevent="handleSend"
          />
          <button
            class="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-white cursor-pointer"
            style="background-color: var(--color-accent); border: none"
            :disabled="store.streaming || isReadonly"
            @click="handleSend"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <!-- 右：草稿预览 -->
    <div class="flex flex-col min-w-0" style="flex: 1">
      <!-- Tab 栏 -->
      <div
        class="flex items-center gap-0 px-4 shrink-0"
        style="border-bottom: 1px solid var(--color-border-subtle)"
      >
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="px-4 py-2.5 text-xs font-medium cursor-pointer"
          style="
            background: none;
            border: none;
            border-bottom: 2px solid transparent;
            transition: all 120ms ease;
          "
          :style="{
            color:
              activeTab === tab.key ? 'var(--color-text-primary)' : 'var(--color-text-quaternary)',
            borderBottomColor: activeTab === tab.key ? 'var(--color-accent)' : 'transparent',
          }"
          @click="activeTab = tab.key"
        >
          {{ tab.label }}
        </button>
      </div>

      <!-- 内容区 -->
      <div class="flex-1 overflow-y-auto">
        <!-- PRD Tab -->
        <div v-if="activeTab === 'prd'" class="h-full flex flex-col">
          <!-- approved 状态：显示 Plane Issue 和 PRD 路径信息 -->
          <div
            v-if="store.currentDraft?.status === 'approved'"
            class="px-8 py-4 shrink-0"
            style="
              border-bottom: 1px solid var(--color-border-subtle);
              background-color: rgba(34, 197, 94, 0.05);
            "
          >
            <p class="text-xs mb-2" style="color: var(--color-text-quaternary); font-weight: 510">
              ✅ 已通过审批，技术设计生成中
            </p>
            <div v-if="store.currentDraft.plane_issue_id" class="text-xs mb-1">
              <span style="color: var(--color-text-quaternary)">Plane Issue：</span>
              <a
                v-if="planeIssueUrl"
                :href="planeIssueUrl"
                target="_blank"
                rel="noopener"
                style="color: var(--color-accent)"
                >{{ store.currentDraft.plane_issue_id }}</a
              >
              <span v-else style="color: var(--color-text-secondary)">{{
                store.currentDraft.plane_issue_id
              }}</span>
            </div>
            <div v-if="store.currentDraft.prd_git_path" class="text-xs">
              <span style="color: var(--color-text-quaternary)">PRD 路径：</span>
              <code style="color: var(--color-text-secondary)">{{
                store.currentDraft.prd_git_path
              }}</code>
            </div>
          </div>
          <div class="flex-1 overflow-y-auto">
            <div
              v-if="!store.currentDraft?.prd_content"
              class="flex flex-col items-center justify-center h-full"
            >
              <FileText
                :size="40"
                style="color: var(--color-border-default); margin-bottom: 12px"
              />
              <p class="text-sm text-center px-8" style="color: var(--color-text-quaternary)">
                AI 正在生成中，先在左侧对话吧
              </p>
            </div>
            <!-- eslint-disable-next-line vue/no-v-html -->
            <div
              v-else
              class="prose px-8 py-6 max-w-none text-sm"
              v-html="renderMd(store.currentDraft.prd_content)"
            />
          </div>
        </div>

        <!-- Issue 预览 Tab -->
        <div v-else-if="activeTab === 'issue'" class="px-8 py-6">
          <div
            v-if="!store.currentDraft?.issue_title"
            class="flex flex-col items-center justify-center h-32"
          >
            <p class="text-sm" style="color: var(--color-text-quaternary)">暂无 Issue 信息</p>
          </div>
          <template v-else>
            <h2 class="text-base mb-4" style="font-weight: 590; color: var(--color-text-primary)">
              {{ store.currentDraft.issue_title }}
            </h2>
            <!-- eslint-disable-next-line vue/no-v-html -->
            <div
              v-if="store.currentDraft.issue_description"
              class="prose text-sm max-w-none"
              v-html="renderMd(store.currentDraft.issue_description)"
            />
            <p v-else class="text-sm" style="color: var(--color-text-quaternary)">暂无描述</p>
          </template>
        </div>

        <!-- 编辑 Tab -->
        <div v-else-if="activeTab === 'edit'" class="px-6 py-4 flex flex-col gap-4">
          <div>
            <label
              class="block text-xs mb-1.5"
              style="color: var(--color-text-quaternary); font-weight: 510"
            >
              Issue 标题
            </label>
            <input
              v-model="editTitle"
              class="w-full px-3 py-2 rounded-md text-sm outline-none"
              style="
                background-color: var(--color-surface-02);
                border: 1px solid var(--color-border-default);
                color: var(--color-text-primary);
              "
              placeholder="Issue 标题"
              :disabled="isReadonly"
            />
          </div>
          <div>
            <label
              class="block text-xs mb-1.5"
              style="color: var(--color-text-quaternary); font-weight: 510"
            >
              Issue 描述（Markdown）
            </label>
            <textarea
              v-model="editIssueDesc"
              rows="6"
              class="w-full px-3 py-2 rounded-md text-sm outline-none resize-none"
              style="
                background-color: var(--color-surface-02);
                border: 1px solid var(--color-border-default);
                color: var(--color-text-primary);
              "
              placeholder="Issue 描述"
              :disabled="isReadonly"
            />
          </div>
          <div>
            <label
              class="block text-xs mb-1.5"
              style="color: var(--color-text-quaternary); font-weight: 510"
            >
              PRD 正文（Markdown）
            </label>
            <textarea
              v-model="editPrdContent"
              rows="14"
              class="w-full px-3 py-2 rounded-md text-sm outline-none resize-none font-mono"
              style="
                background-color: var(--color-surface-02);
                border: 1px solid var(--color-border-default);
                color: var(--color-text-primary);
              "
              placeholder="PRD 正文内容"
              :disabled="isReadonly"
            />
          </div>
          <div class="flex justify-end gap-2">
            <button
              class="px-4 py-1.5 rounded-md text-xs cursor-pointer"
              style="
                background: none;
                border: 1px solid var(--color-border-default);
                color: var(--color-text-secondary);
              "
              :disabled="store.loading"
              @click="resetEditFields"
            >
              重置
            </button>
            <button
              class="px-4 py-1.5 rounded-md text-xs text-white cursor-pointer"
              style="background-color: var(--color-accent); border: none; font-weight: 510"
              :disabled="store.loading || isReadonly"
              @click="handleSaveEdit"
            >
              {{ store.loading ? "保存中..." : "保存" }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Toast -->
    <Transition name="toast">
      <div
        v-if="toast"
        class="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg text-sm text-white z-50"
        style="background-color: var(--color-accent); box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3)"
      >
        {{ toast }}
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useRequirementStore } from "../stores/requirement";
import { useWorkspaceStore } from "../stores/workspace";
import { usePlaneUrl } from "../composables/usePlaneUrl";
import { marked } from "marked";
import { ChevronLeft, MessageSquare, FileText } from "lucide-vue-next";

defineOptions({ name: "RequirementChatPage" });

const route = useRoute();
const router = useRouter();
const store = useRequirementStore();
const wsStore = useWorkspaceStore();

const inputText = ref("");
const activeTab = ref<"prd" | "issue" | "edit">("prd");
const msgContainer = ref<HTMLElement | null>(null);
const toast = ref("");
let toastTimer: ReturnType<typeof setTimeout> | null = null;

const tabs = [
  { key: "prd" as const, label: "PRD 预览" },
  { key: "issue" as const, label: "Issue 预览" },
  { key: "edit" as const, label: "编辑" },
];

// Edit fields
const editTitle = ref("");
const editIssueDesc = ref("");
const editPrdContent = ref("");

const messages = computed(() => store.messages);

const { issueUrl } = usePlaneUrl();
const planeIssueUrl = computed(() => {
  const draft = store.currentDraft;
  if (!draft?.plane_issue_id) return null;
  return issueUrl(draft.plane_issue_id);
});

const isReadonly = computed(() => {
  const s = store.currentDraft?.status;
  return s === "approved" || s === "rejected" || s === "abandoned";
});

const canFinalize = computed(() => {
  const draft = store.currentDraft;
  if (!draft || draft.status !== "drafting") return false;
  return !!(draft.prd_content && draft.prd_content.length > 50);
});

function renderMd(content: string) {
  if (!content) return "";
  return marked.parse(content, { async: false }) as string;
}

function statusLabel(status?: string) {
  const map: Record<string, string> = {
    drafting: "草稿中",
    review: "待 Review",
    approved: "已通过",
    rejected: "已拒绝",
    abandoned: "已放弃",
  };
  return map[status ?? ""] ?? status ?? "-";
}

function statusStyle(status?: string) {
  const base = "font-weight: 510;";
  if (status === "drafting")
    return `${base} background-color: rgba(94,106,210,0.12); color: var(--color-accent)`;
  if (status === "review") return `${base} background-color: rgba(234,179,8,0.12); color: #ca8a04`;
  if (status === "approved")
    return `${base} background-color: rgba(34,197,94,0.12); color: var(--color-success)`;
  if (status === "rejected")
    return `${base} background-color: rgba(239,68,68,0.08); color: var(--color-error)`;
  return `${base} background-color: var(--color-surface-05); color: var(--color-text-quaternary)`;
}

function showToast(msg: string) {
  toast.value = msg;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.value = "";
  }, 2500);
}

function scrollToBottom() {
  nextTick(() => {
    if (msgContainer.value) {
      msgContainer.value.scrollTop = msgContainer.value.scrollHeight;
    }
  });
}

function syncEditFields() {
  editTitle.value = store.currentDraft?.issue_title ?? "";
  editIssueDesc.value = store.currentDraft?.issue_description ?? "";
  editPrdContent.value = store.currentDraft?.prd_content ?? "";
}

function resetEditFields() {
  syncEditFields();
}

async function handleSend() {
  if (!inputText.value.trim() || store.streaming) return;
  const msg = inputText.value;
  inputText.value = "";
  await store.sendMessage(msg);
  scrollToBottom();
}

async function handleSaveEdit() {
  await store.saveEdit({
    issue_title: editTitle.value,
    issue_description: editIssueDesc.value,
    prd_content: editPrdContent.value,
  });
  if (!store.error) {
    showToast("保存成功");
    activeTab.value = "prd";
  }
}

async function handleFinalize() {
  if (!canFinalize.value) return;
  const result = await store.finalize();
  if (result.ok) {
    if (result.feishu_sent === false) {
      showToast("已提交，但飞书通知失败");
    } else {
      showToast("草稿已提交 Review");
    }
  }
}

async function handleApprove() {
  if (store.loading) return;
  const result = await store.approve();
  if (result.ok) {
    showToast("✅ 已通过，技术设计生成中");
  } else {
    showToast(`审批失败：${result.error ?? "未知错误"}`);
  }
}

watch(() => store.messages.length, scrollToBottom);

watch(
  () => store.currentDraft,
  () => syncEditFields(),
  { deep: true },
);

watch(activeTab, (tab) => {
  if (tab === "edit") syncEditFields();
});

onMounted(async () => {
  const id = route.params.id;
  if (id) {
    await store.loadDraft(Number(id));
  } else {
    // /requirements/new — create draft then redirect
    const wsId = wsStore.currentId;
    if (!wsId) {
      store.error = "请先选择工作空间";
      return;
    }
    const draft = await store.createDraft(wsId);
    if (draft) {
      await router.replace({ name: "requirement-detail", params: { id: draft.id } });
    }
  }
});
</script>

<style scoped>
.prose :deep(h1),
.prose :deep(h2),
.prose :deep(h3) {
  color: var(--color-text-primary);
  font-weight: 590;
  margin-top: 1.25em;
  margin-bottom: 0.5em;
}
.prose :deep(p) {
  color: var(--color-text-secondary);
  line-height: 1.7;
  margin-bottom: 0.75em;
}
.prose :deep(ul),
.prose :deep(ol) {
  color: var(--color-text-secondary);
  padding-left: 1.5em;
  margin-bottom: 0.75em;
}
.prose :deep(code) {
  background-color: var(--color-surface-04);
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 0.85em;
}
.prose :deep(pre) {
  background-color: var(--color-surface-04);
  padding: 12px;
  border-radius: 6px;
  overflow-x: auto;
  margin-bottom: 0.75em;
}
.prose :deep(blockquote) {
  border-left: 3px solid var(--color-border-default);
  padding-left: 1em;
  color: var(--color-text-tertiary);
  margin: 0.75em 0;
}
.streaming-cursor {
  color: var(--color-text-quaternary);
  animation: pulse 1.2s infinite;
}
@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
}
.toast-enter-active,
.toast-leave-active {
  transition: all 200ms ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}
</style>
