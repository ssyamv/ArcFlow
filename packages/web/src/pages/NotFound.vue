<template>
  <div class="flex flex-col items-center justify-center h-[60vh]">
    <h1
      class="text-7xl mb-2"
      style="font-weight: 510; color: var(--color-text-quaternary); letter-spacing: -1px"
    >
      404
    </h1>
    <p class="text-sm mb-8" style="color: var(--color-text-tertiary)">页面未找到</p>
    <router-link
      to="/"
      class="px-4 py-2 rounded-md text-sm transition-colors"
      style="
        font-weight: 510;
        color: var(--color-text-secondary);
        border: 1px solid var(--color-border-default);
        background: transparent;
      "
    >
      返回首页
    </router-link>
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: "NotFound" });
</script>
