<template>
  <div
    class="min-h-screen flex items-center justify-center px-4"
    style="background-color: var(--color-bg-primary)"
  >
    <div
      class="w-full max-w-md rounded-lg border p-6 text-center space-y-4"
      style="background-color: var(--color-bg-secondary); border-color: var(--color-border-primary)"
    >
      <div class="text-2xl" style="color: var(--color-text-primary)">410 Gone</div>
      <p class="text-sm" style="color: var(--color-text-secondary)">
        该页面已下线（Batch 4-H）。需求创建、修改、提交审核现在通过
        <span style="color: var(--color-text-primary)">AI 对话</span> 完成，
        在对话里说"开个新需求"、"把这段写进草稿"即可。
      </p>
      <router-link
        to="/chat"
        class="inline-block rounded-md px-3 py-1.5 text-sm text-white"
        style="background-color: var(--color-accent)"
      >
        去 AI 对话
      </router-link>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from "vue";
// Signal 410 to any monitoring by setting the document title; browsers
// themselves can't return a 410 status from an SPA, but the page makes the
// deprecation explicit.
onMounted(() => {
  document.title = "410 Gone — ArcFlow";
});
</script>
