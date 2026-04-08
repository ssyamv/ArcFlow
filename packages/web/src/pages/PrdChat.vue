<script setup lang="ts">
import { ref, nextTick, watch } from "vue";
import { usePrdChatStore } from "../stores/prdChat";

const store = usePrdChatStore();
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
</script>

<template>
  <div class="flex flex-col h-[calc(100vh-3rem)] max-w-4xl mx-auto">
    <!-- Header -->
    <div class="flex items-center justify-between pb-4 border-b border-gray-200">
      <div>
        <h1 class="text-xl font-semibold text-gray-900 m-0">PRD 智能生成</h1>
        <p class="text-sm text-gray-500 mt-1 m-0">描述你的需求，AI 帮你生成标准 PRD 文档</p>
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
          <p class="m-0 text-gray-700">你好！请描述一下你想做的功能或需求，简单几句话就行。</p>
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
          {{ msg.role === "user" ? "PM" : "AI" }}
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
          <p class="m-0 whitespace-pre-wrap">{{ msg.content }}</p>
          <p
            v-if="
              msg.role === 'assistant' &&
              store.loading &&
              msg === store.messages.at(-1) &&
              !msg.content
            "
            class="m-0 text-gray-400"
          >
            思考中...
          </p>
        </div>
      </div>

      <!-- PRD Complete Card -->
      <div v-if="store.prdResult" class="flex items-start gap-3">
        <div
          class="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center text-white text-sm shrink-0"
        >
          ✓
        </div>
        <div class="bg-green-50 border border-green-200 rounded-lg px-4 py-3 max-w-[80%]">
          <p class="m-0 font-medium text-green-800">PRD 已生成：{{ store.prdResult.title }}</p>
          <p class="m-0 mt-1 text-sm text-green-700">文件路径：{{ store.prdResult.prdPath }}</p>
          <a
            :href="store.prdResult.wikiUrl"
            target="_blank"
            class="inline-block mt-2 px-3 py-1.5 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 no-underline transition-colors"
          >
            在 Wiki.js 中查看
          </a>
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
          placeholder="描述你的需求..."
          rows="2"
          class="flex-1 resize-none rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:bg-gray-100"
          @keydown="handleKeydown"
        />
        <button
          :disabled="store.loading || !input.trim()"
          class="px-4 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors self-end"
          @click="handleSend"
        >
          {{ store.loading ? "生成中..." : "发送" }}
        </button>
      </div>
    </div>
  </div>
</template>
