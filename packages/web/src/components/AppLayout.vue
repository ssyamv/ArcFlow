<template>
  <div class="flex min-h-screen" style="background-color: var(--color-bg-primary)">
    <!-- Sidebar -->
    <nav
      class="w-56 shrink-0 flex flex-col"
      style="
        background-color: var(--color-bg-panel);
        border-right: 1px solid var(--color-border-subtle);
      "
    >
      <!-- Logo -->
      <div class="px-4 py-4" style="border-bottom: 1px solid var(--color-border-subtle)">
        <h2 class="m-0 text-base" style="font-weight: 510; color: var(--color-text-primary)">
          ArcFlow
        </h2>
      </div>

      <!-- Navigation -->
      <ul class="list-none p-0 m-0 mt-1 flex-1 px-2">
        <li v-for="item in navItems" :key="item.path">
          <router-link
            :to="item.path"
            class="flex items-center gap-2.5 px-3 py-1.5 rounded-md no-underline text-sm my-0.5"
            :class="isActive(item.path) ? 'nav-active' : 'nav-default'"
            style="transition: all 120ms ease"
          >
            <component :is="item.icon" :size="16" style="opacity: 0.6" />
            {{ item.label }}
          </router-link>
        </li>
      </ul>

      <!-- User -->
      <div
        class="px-3 py-3 flex items-center gap-2.5 cursor-pointer"
        style="border-top: 1px solid var(--color-border-subtle); transition: all 120ms ease"
        @click="$router.push('/profile')"
      >
        <div
          class="w-7 h-7 rounded-full flex items-center justify-center text-xs shrink-0"
          style="
            background-color: var(--color-surface-05);
            color: var(--color-text-secondary);
            font-weight: 510;
          "
        >
          <img
            v-if="auth.user?.avatar_url"
            :src="auth.user.avatar_url"
            class="w-full h-full rounded-full object-cover"
          />
          <span v-else>{{ (auth.user?.name ?? "U")[0] }}</span>
        </div>
        <div class="min-w-0">
          <div
            class="text-xs truncate"
            style="font-weight: 510; color: var(--color-text-secondary)"
          >
            {{ auth.user?.name ?? "用户" }}
          </div>
          <div class="text-xs" style="color: var(--color-text-quaternary)">
            {{ auth.user?.role ?? "member" }}
          </div>
        </div>
      </div>
    </nav>

    <!-- Main -->
    <div class="flex-1 flex flex-col min-w-0">
      <!-- Header -->
      <header
        class="h-12 flex items-center justify-between px-6 shrink-0"
        style="border-bottom: 1px solid var(--color-border-subtle)"
      >
        <div class="text-xs" style="color: var(--color-text-tertiary); font-weight: 510">
          <span style="color: var(--color-text-quaternary)">ArcFlow /</span>
          {{ currentPageTitle }}
        </div>
      </header>

      <!-- Content -->
      <main class="flex-1 overflow-y-auto p-8">
        <div class="max-w-5xl mx-auto">
          <router-view />
        </div>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { useAuthStore } from "../stores/auth";
import { LayoutDashboard, MessageSquare, List, Zap } from "lucide-vue-next";

const route = useRoute();
const auth = useAuthStore();

const navItems = [
  { path: "/dashboard", label: "仪表盘", icon: LayoutDashboard },
  { path: "/chat", label: "AI 对话", icon: MessageSquare },
  { path: "/workflows", label: "工作流", icon: List },
  { path: "/trigger", label: "触发工作流", icon: Zap },
];

const currentPageTitle = computed(() => {
  const item = navItems.find((i) => route.path.startsWith(i.path));
  if (route.path === "/profile") return "个人信息";
  if (route.path.startsWith("/workspace")) return "工作空间设置";
  return item?.label ?? "";
});

function isActive(path: string) {
  return route.path.startsWith(path);
}
</script>

<style scoped>
.nav-default {
  color: var(--color-text-secondary);
}
.nav-default:hover {
  background-color: var(--color-surface-03);
  color: var(--color-text-primary);
}
.nav-active {
  background-color: var(--color-surface-05);
  color: var(--color-text-primary);
  border-left: 2px solid var(--color-accent);
}
</style>
