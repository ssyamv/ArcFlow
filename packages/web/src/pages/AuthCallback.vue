<template>
  <div
    class="min-h-screen flex items-center justify-center"
    style="background-color: var(--color-bg-primary)"
  >
    <div class="text-center">
      <p v-if="error" style="color: var(--color-error-light)">{{ error }}</p>
      <p v-else style="color: var(--color-text-tertiary)">登录中...</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";

const router = useRouter();
const auth = useAuthStore();
const error = ref<string | null>(null);

onMounted(async () => {
  const token = auth.handleCallback();
  if (!token) {
    error.value = "登录失败：未收到授权令牌";
    return;
  }

  const ok = await auth.loadUser();
  if (ok) {
    router.replace("/dashboard");
  } else {
    error.value = "登录失败：无法获取用户信息";
  }
});
</script>
