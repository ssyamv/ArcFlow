<template>
  <router-view v-if="isPublicRoute" />
  <AppLayout v-else-if="authReady" />
  <div
    v-else
    class="min-h-screen flex items-center justify-center"
    style="background-color: var(--color-bg-primary)"
  >
    <p style="color: var(--color-text-tertiary)">加载中...</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { useAuthStore } from "./stores/auth";
import { useWorkspaceStore } from "./stores/workspace";
import AppLayout from "./components/AppLayout.vue";

const route = useRoute();
const auth = useAuthStore();
const wsStore = useWorkspaceStore();
const authReady = ref(false);

const isPublicRoute = computed(() => route.meta.public === true);

onMounted(async () => {
  if (auth.token) {
    await auth.loadUser();
    await wsStore.load();
  }
  authReady.value = true;
});
</script>
