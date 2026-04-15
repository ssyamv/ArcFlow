<template>
  <div class="flex" style="height: calc(100vh - 48px)">
    <!-- Conversation Sidebar -->
    <div
      class="shrink-0 flex flex-col transition-all duration-150"
      :style="{
        width: sidebarCollapsed ? '0px' : '256px',
        overflow: sidebarCollapsed ? 'hidden' : 'visible',
        backgroundColor: 'var(--color-bg-panel)',
        borderRight: sidebarCollapsed ? 'none' : '1px solid var(--color-border-subtle)',
      }"
    >
      <!-- Search + New -->
      <div class="p-3 flex gap-2" style="border-bottom: 1px solid var(--color-border-subtle)">
        <input
          v-model="searchQuery"
          type="text"
          placeholder="搜索对话..."
          class="flex-1 px-2.5 py-1.5 rounded-md text-xs outline-none"
          style="
            background-color: var(--color-surface-02);
            border: 1px solid var(--color-border-default);
            color: var(--color-text-secondary);
          "
          @input="handleSearch"
        />
        <button
          class="px-2.5 py-1.5 rounded-md text-xs text-white cursor-pointer"
          style="background-color: var(--color-accent); font-weight: 510; border: none"
          @click="handleNew"
        >
          +
        </button>
      </div>

      <!-- Conversation List -->
      <div class="flex-1 overflow-y-auto px-2 py-1">
        <template v-for="group in displayGroups" :key="group.label">
          <template v-if="group.items.length">
            <div class="group-title">{{ group.label }}</div>
            <div
              v-for="c in group.items"
              :key="c.id"
              class="flex items-center gap-2 px-3 py-1.5 rounded-md cursor-pointer text-xs my-0.5 group"
              :style="{
                backgroundColor:
                  c.id === convStore.currentId ? 'var(--color-surface-05)' : 'transparent',
                color:
                  c.id === convStore.currentId
                    ? 'var(--color-text-primary)'
                    : 'var(--color-text-secondary)',
                fontWeight: 510,
                transition: 'all 120ms ease',
              }"
              @click="selectConv(c.id)"
            >
              <span class="flex-1 truncate">{{ c.title }}</span>
              <button
                class="opacity-0 group-hover:opacity-100 text-xs px-1 rounded shrink-0"
                style="
                  color: var(--color-text-quaternary);
                  background: none;
                  border: none;
                  cursor: pointer;
                "
                @click.stop="handleDelete(c.id)"
              >
                ×
              </button>
            </div>
          </template>
        </template>
      </div>
    </div>

    <!-- Chat Area -->
    <div class="flex-1 flex flex-col min-w-0">
      <template v-if="convStore.currentId">
        <!-- Toolbar -->
        <div
          class="px-4 py-2 flex items-center shrink-0"
          style="border-bottom: 1px solid var(--color-border-subtle)"
        >
          <button
            class="w-6 h-6 rounded flex items-center justify-center cursor-pointer"
            style="background: none; border: none; color: var(--color-text-quaternary)"
            title="折叠对话列表"
            @click="sidebarCollapsed = !sidebarCollapsed"
          >
            <PanelLeft :size="14" />
          </button>
          <span
            class="ml-2 text-xs truncate"
            style="color: var(--color-text-tertiary); font-weight: 510"
          >
            {{ convStore.conversations.find((c) => c.id === convStore.currentId)?.title ?? "" }}
          </span>
        </div>
        <!-- Messages -->
        <div ref="msgContainer" class="flex-1 overflow-y-auto px-6 py-4">
          <div v-for="msg in chatStore.messages" :key="msg.id" class="mb-4">
            <div v-if="msg.role === 'user'" class="flex justify-end">
              <div
                class="max-w-lg px-3 py-2 rounded-lg text-sm"
                style="background-color: rgba(94, 106, 210, 0.15); color: var(--color-text-primary)"
              >
                {{ msg.content }}
              </div>
            </div>
            <div v-else class="max-w-2xl space-y-2">
              <!-- Skill badges -->
              <div v-if="sidecarOf(msg.id)?.skillsLoaded.length" class="flex flex-wrap gap-1.5">
                <span
                  v-for="s in sidecarOf(msg.id)!.skillsLoaded"
                  :key="s"
                  class="text-[10px] px-1.5 py-0.5 rounded"
                  style="
                    background-color: var(--color-surface-05);
                    color: var(--color-text-tertiary);
                  "
                  >📎 {{ s }}</span
                >
              </div>

              <!-- Thinking (collapsible, default collapsed) -->
              <details
                v-if="sidecarOf(msg.id)?.thinking"
                class="text-xs rounded-md px-2 py-1"
                style="background-color: var(--color-surface-02); color: var(--color-text-tertiary)"
              >
                <summary class="cursor-pointer select-none">💭 思考过程</summary>
                <pre class="whitespace-pre-wrap mt-1 text-[11px]">{{
                  sidecarOf(msg.id)!.thinking
                }}</pre>
              </details>

              <!-- Tool timeline -->
              <div v-if="sidecarOf(msg.id)?.toolCalls.length" class="space-y-1">
                <div
                  v-for="tc in sidecarOf(msg.id)!.toolCalls"
                  :key="tc.id"
                  class="text-[11px] flex items-center gap-1.5"
                  style="color: var(--color-text-tertiary)"
                >
                  <span>{{ tc.status === "running" ? "⟳" : tc.status === "ok" ? "✓" : "✗" }}</span>
                  <span style="color: var(--color-text-secondary)">{{ tc.name }}</span>
                  <span class="truncate">{{ tc.summary ?? tc.preview ?? "" }}</span>
                </div>
              </div>

              <!-- Assistant message -->
              <div class="prose text-sm">
                <span v-html="renderMd(msg.content)" /><span
                  v-if="chatStore.streamingId === msg.id"
                  class="streaming-cursor"
                  aria-hidden="true"
                  >▍</span
                >
              </div>

              <!-- Artifacts -->
              <div
                v-for="art in sidecarOf(msg.id)?.artifacts ?? []"
                :key="art.id"
                class="text-xs rounded-md border p-2"
                style="
                  border-color: var(--color-border-subtle);
                  background-color: var(--color-surface-02);
                "
              >
                <div class="font-medium mb-1" style="color: var(--color-text-primary)">
                  📄 {{ art.title }}
                  <span class="ml-1 text-[10px]" style="color: var(--color-text-quaternary)"
                    >({{ art.type }})</span
                  >
                </div>
                <pre
                  class="whitespace-pre-wrap text-[11px]"
                  style="color: var(--color-text-secondary)"
                  >{{ art.content }}</pre
                >
              </div>
            </div>
          </div>
          <div
            v-if="chatStore.typing && !hasStreamingContent"
            class="text-sm flex items-center gap-1"
            style="color: var(--color-text-tertiary)"
          >
            <span class="thinking-dot" />
            <span class="thinking-dot" style="animation-delay: 0.15s" />
            <span class="thinking-dot" style="animation-delay: 0.3s" />
            <span class="ml-1 text-xs">思考中…</span>
          </div>
        </div>

        <!-- Input -->
        <div class="px-6 pb-4 pt-2">
          <div
            class="flex items-end gap-2 p-3 rounded-lg"
            style="
              background-color: var(--color-surface-02);
              border: 1px solid var(--color-border-default);
            "
          >
            <textarea
              v-model="input"
              rows="1"
              placeholder="输入消息，Shift+Enter 换行"
              class="flex-1 bg-transparent outline-none resize-none text-sm"
              style="color: var(--color-text-secondary); max-height: 144px"
              @keydown.enter.exact.prevent="handleSend"
            />
            <button
              class="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-white cursor-pointer"
              style="background-color: var(--color-accent); border: none"
              :disabled="chatStore.loading"
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
      </template>

      <!-- Empty State -->
      <template v-else>
        <div
          v-if="sidebarCollapsed"
          class="px-4 py-2"
          style="border-bottom: 1px solid var(--color-border-subtle)"
        >
          <button
            class="w-6 h-6 rounded flex items-center justify-center cursor-pointer"
            style="background: none; border: none; color: var(--color-text-quaternary)"
            title="展开对话列表"
            @click="sidebarCollapsed = false"
          >
            <PanelLeft :size="14" />
          </button>
        </div>
        <div class="flex-1 flex flex-col items-center justify-center">
          <div
            class="text-4xl mb-4"
            style="color: var(--color-bg-surface-secondary); font-weight: 510"
          >
            ArcFlow
          </div>
          <p class="text-sm" style="color: var(--color-text-tertiary)">选择一个对话或开始新对话</p>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from "vue";
import { useConversationStore } from "../stores/conversation";
import { useChatStore } from "../stores/chat";
import { marked } from "marked";
import { PanelLeft } from "lucide-vue-next";
import type { Conversation } from "../api/conversations";

defineOptions({ name: "AiChatPage" });

const convStore = useConversationStore();
const chatStore = useChatStore();

function sidecarOf(id: number) {
  return chatStore.sidecars[id];
}
const sidebarCollapsed = ref(false);
const input = ref("");
const searchQuery = ref("");
const msgContainer = ref<HTMLElement | null>(null);

const displayGroups = computed(() => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);

  const pinned: Conversation[] = [];
  const todayItems: Conversation[] = [];
  const yesterdayItems: Conversation[] = [];
  const earlier: Conversation[] = [];

  for (const c of convStore.conversations) {
    if (c.pinned) {
      pinned.push(c);
      continue;
    }
    const d = new Date(c.updated_at);
    if (d >= today) todayItems.push(c);
    else if (d >= yesterday) yesterdayItems.push(c);
    else earlier.push(c);
  }

  const groups = [];
  if (pinned.length) groups.push({ label: "置顶", items: pinned });
  if (todayItems.length) groups.push({ label: "今天", items: todayItems });
  if (yesterdayItems.length) groups.push({ label: "昨天", items: yesterdayItems });
  if (earlier.length) groups.push({ label: "更早", items: earlier });
  return groups;
});

function renderMd(content: string) {
  if (!content) return "";
  return marked.parse(content, { async: false }) as string;
}

async function handleNew() {
  await convStore.create();
  chatStore.clear();
}

async function selectConv(id: number) {
  convStore.select(id);
  await chatStore.loadMessages(id);
  scrollToBottom();
}

async function handleSend() {
  if (!input.value.trim() || !convStore.currentId) return;
  const msg = input.value;
  input.value = "";
  const convId = convStore.currentId;
  const conv = convStore.conversations.find((c) => c.id === convId);
  const shouldAutoTitle = !!conv && (!conv.title || conv.title === "新对话");
  if (shouldAutoTitle) {
    const title = msg.replace(/\s+/g, " ").trim().slice(0, 24);
    if (title) void convStore.update(convId, { title });
  }
  await chatStore.send(convId, msg);
  scrollToBottom();
}

function handleSearch() {
  if (searchQuery.value.trim()) {
    convStore.search(searchQuery.value);
  } else {
    convStore.load();
  }
}

async function handleDelete(id: number) {
  await convStore.remove(id);
  chatStore.clear();
}

function scrollToBottom() {
  nextTick(() => {
    if (msgContainer.value) {
      msgContainer.value.scrollTop = msgContainer.value.scrollHeight;
    }
  });
}

const hasStreamingContent = computed(() => {
  const id = chatStore.streamingId;
  if (id == null) return false;
  const m = chatStore.messages.find((x) => x.id === id);
  return !!m && m.content.length > 0;
});

watch(() => chatStore.messages.length, scrollToBottom);
watch(() => {
  const id = chatStore.streamingId;
  if (id == null) return "";
  return chatStore.messages.find((x) => x.id === id)?.content ?? "";
}, scrollToBottom);

onMounted(() => {
  convStore.load();
});
</script>

<style scoped>
.group-title {
  font-size: 11px;
  font-weight: 510;
  color: var(--color-text-quaternary);
  padding: 8px 12px 4px;
}
.thinking-dot {
  display: inline-block;
  width: 5px;
  height: 5px;
  border-radius: 9999px;
  background-color: currentColor;
  opacity: 0.4;
  animation: thinking-bounce 1s infinite ease-in-out;
}
@keyframes thinking-bounce {
  0%,
  80%,
  100% {
    transform: scale(0.6);
    opacity: 0.3;
  }
  40% {
    transform: scale(1);
    opacity: 0.9;
  }
}
.streaming-cursor {
  display: inline-block;
  margin-left: 2px;
  color: var(--color-accent);
  animation: cursor-blink 1s steps(2) infinite;
}
@keyframes cursor-blink {
  50% {
    opacity: 0;
  }
}
</style>
