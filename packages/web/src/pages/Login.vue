<template>
  <div
    class="min-h-screen flex items-center justify-center"
    style="background-color: var(--color-bg-primary)"
  >
    <div
      class="w-full max-w-sm p-8 rounded-xl"
      style="
        background-color: var(--color-surface-02);
        border: 1px solid var(--color-border-default);
      "
    >
      <div class="text-center mb-8">
        <h1
          class="text-2xl mb-2"
          style="font-weight: 510; color: var(--color-text-primary); letter-spacing: -0.288px"
        >
          ArcFlow
        </h1>
        <p class="text-sm" style="color: var(--color-text-tertiary)">AI 研发运营一体化平台</p>
      </div>

      <button
        class="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-white text-sm cursor-pointer transition-linear"
        style="background-color: var(--color-accent); font-weight: 510; border: none"
        @click="handleLogin"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M4 4h7.5v7.5H4V4Z" fill="currentColor" opacity="0.9" />
          <path d="M12.5 4H20v7.5h-7.5V4Z" fill="currentColor" opacity="0.7" />
          <path d="M4 12.5h7.5V20H4v-7.5Z" fill="currentColor" opacity="0.7" />
          <path d="M12.5 12.5H20V20h-7.5v-7.5Z" fill="currentColor" opacity="0.5" />
        </svg>
        通过飞书登录
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: "UserLogin" });

import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();

function handleLogin() {
  auth.loginWithFeishu();
}
</script>
