<script setup lang="ts">
import { ref, nextTick, watch, onUnmounted } from "vue";
import { marked } from "marked";
import { useChatStore } from "../stores/chat";

marked.setOptions({ breaks: true });

function renderMd(text: string): string {
  return marked.parse(text) as string;
}

const store = useChatStore();
const input = ref("");
const chatContainer = ref<HTMLElement | null>(null);

function scrollToBottom() {
  nextTick(() => {
    if (chatContainer.value) {
      chatContainer.value.scrollTop = chatContainer.value.scrollHeight;
    }
  });
}

watch(() => store.messages.length, scrollToBottom);
watch(() => store.messages.at(-1)?.content, scrollToBottom);

async function handleSend() {
  const msg = input.value.trim();
  if (!msg || store.loading) return;
  input.value = "";
  await store.send(msg);
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
}

function handleNewChat() {
  store.reset();
  input.value = "";
}

onUnmounted(() => {
  store.cleanup();
});
</script>

<template>
  <div class="flex flex-col h-[calc(100vh-3rem)] max-w-4xl mx-auto">
    <!-- Header -->
    <div class="flex items-center justify-between pb-4 border-b border-gray-200">
      <div>
        <h1 class="text-xl font-semibold text-gray-900 m-0">AI 助手</h1>
        <p class="text-sm text-gray-500 mt-1 m-0">知识问答、PRD 生成、任务管理、工作流触发</p>
      </div>
      <button
        class="px-3 py-1.5 text-sm bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
        @click="handleNewChat"
      >
        新建对话
      </button>
    </div>

    <!-- Chat Messages -->
    <div ref="chatContainer" class="flex-1 overflow-y-auto py-4 space-y-4">
      <!-- Welcome message when empty -->
      <div v-if="store.messages.length === 0" class="flex items-start gap-3">
        <div
          class="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white text-sm font-medium shrink-0"
        >
          AI
        </div>
        <div class="bg-white rounded-lg px-4 py-3 shadow-sm border border-gray-100 max-w-[80%]">
          <p class="m-0 text-gray-700">你好！我是 ArcFlow AI 助手，可以帮你：</p>
          <ul class="mt-2 mb-0 text-gray-600 text-sm space-y-1">
            <li>查询项目知识库</li>
            <li>生成 PRD 文档</li>
            <li>管理 Plane 任务</li>
            <li>触发工作流</li>
          </ul>
        </div>
      </div>

      <!-- Messages -->
      <div
        v-for="msg in store.messages"
        :key="msg.id"
        class="flex items-start gap-3"
        :class="msg.role === 'user' ? 'flex-row-reverse' : ''"
      >
        <!-- Avatar -->
        <div
          class="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-medium shrink-0"
          :class="msg.role === 'user' ? 'bg-slate-700' : 'bg-indigo-600'"
        >
          {{ msg.role === "user" ? "You" : "AI" }}
        </div>
        <!-- Bubble -->
        <div
          class="rounded-lg px-4 py-3 max-w-[80%]"
          :class="
            msg.role === 'user'
              ? 'bg-indigo-600 text-white'
              : 'bg-white shadow-sm border border-gray-100 text-gray-700'
          "
        >
          <div
            v-if="msg.role === 'assistant' && msg.content"
            class="prose prose-sm max-w-none"
            v-html="renderMd(msg.content)"
          />
          <p v-else-if="msg.role === 'user'" class="m-0 whitespace-pre-wrap">{{ msg.content }}</p>
          <p
            v-if="msg.role === 'assistant' && !msg.content && store.loading"
            class="m-0 text-gray-400"
          >
            思考中...
          </p>
        </div>
      </div>

      <!-- Typing indicator -->
      <div v-if="store.typing" class="flex items-start gap-3">
        <div
          class="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white text-sm font-medium shrink-0"
        >
          AI
        </div>
        <div class="bg-white rounded-lg px-4 py-3 shadow-sm border border-gray-100">
          <p class="m-0 text-gray-400">正在输入...</p>
        </div>
      </div>

      <!-- Error -->
      <div v-if="store.error" class="flex items-start gap-3">
        <div
          class="w-8 h-8 rounded-full bg-red-600 flex items-center justify-center text-white text-sm shrink-0"
        >
          !
        </div>
        <div class="bg-red-50 border border-red-200 rounded-lg px-4 py-3 max-w-[80%]">
          <p class="m-0 text-red-700">{{ store.error }}</p>
        </div>
      </div>
    </div>

    <!-- Input -->
    <div class="border-t border-gray-200 pt-4">
      <div class="flex gap-2">
        <textarea
          v-model="input"
          :disabled="store.loading"
          placeholder="输入你的问题..."
          rows="2"
          class="flex-1 resize-none rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:bg-gray-100"
          @keydown="handleKeydown"
        />
        <button
          :disabled="store.loading || !input.trim()"
          class="px-4 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors self-end"
          @click="handleSend"
        >
          {{ store.loading ? "等待中..." : "发送" }}
        </button>
      </div>
    </div>
  </div>
</template>
