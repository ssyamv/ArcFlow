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
      <!-- Workspace Switcher -->
      <div class="px-3 py-3 relative" style="border-bottom: 1px solid var(--color-border-subtle)">
        <button
          class="w-full flex items-center justify-between px-2 py-1.5 rounded-md text-left cursor-pointer"
          style="
            background: none;
            border: none;
            color: var(--color-text-primary);
            transition: all 120ms ease;
          "
          @click="wsDropdownOpen = !wsDropdownOpen"
        >
          <span class="text-sm truncate" style="font-weight: 510">
            {{ wsStore.current?.name ?? "ArcFlow" }}
          </span>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            style="opacity: 0.5"
            :style="{ transform: wsDropdownOpen ? 'rotate(180deg)' : '' }"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>

        <!-- Dropdown -->
        <div
          v-if="wsDropdownOpen"
          class="absolute left-2 right-2 top-full mt-1 rounded-xl py-1 z-50"
          style="
            background-color: var(--color-bg-surface);
            border: 1px solid var(--color-border-default);
            box-shadow: rgba(0, 0, 0, 0.4) 0px 2px 4px;
          "
        >
          <div
            v-for="ws in wsStore.workspaces"
            :key="ws.id"
            class="flex items-center gap-2 px-3 py-1.5 cursor-pointer text-xs"
            :style="{
              color:
                ws.id === wsStore.currentId
                  ? 'var(--color-text-primary)'
                  : 'var(--color-text-secondary)',
              backgroundColor:
                ws.id === wsStore.currentId ? 'var(--color-surface-05)' : 'transparent',
              transition: 'all 120ms ease',
            }"
            @click="switchWorkspace(ws.id)"
          >
            <span style="width: 14px">{{ ws.id === wsStore.currentId ? "✓" : "" }}</span>
            <div class="min-w-0">
              <div class="truncate" style="font-weight: 510">{{ ws.name }}</div>
              <div style="color: var(--color-text-quaternary); font-size: 10px">{{ ws.slug }}</div>
            </div>
          </div>
          <div
            style="
              border-top: 1px solid var(--color-border-subtle);
              margin-top: 4px;
              padding-top: 4px;
            "
          >
            <button
              class="w-full text-left px-3 py-1.5 text-xs cursor-pointer"
              style="
                background: none;
                border: none;
                color: var(--color-accent-violet);
                transition: all 120ms ease;
              "
              @click="handleSyncPlane"
            >
              同步 Plane 项目
            </button>
          </div>
        </div>
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
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import { useAuthStore } from "../stores/auth";
import { useWorkspaceStore } from "../stores/workspace";
import { LayoutDashboard, MessageSquare, List, Zap, Settings, FileText } from "lucide-vue-next";

const route = useRoute();
const auth = useAuthStore();
const wsStore = useWorkspaceStore();
const wsDropdownOpen = ref(false);

const navItems = computed(() => {
  const items = [
    { path: "/dashboard", label: "仪表盘", icon: LayoutDashboard },
    { path: "/chat", label: "AI 对话", icon: MessageSquare },
    { path: "/docs", label: "文档", icon: FileText },
    { path: "/workflows", label: "工作流", icon: List },
    { path: "/trigger", label: "触发工作流", icon: Zap },
  ];
  if (wsStore.isAdmin) {
    items.push({ path: "/workspace/settings", label: "工作空间设置", icon: Settings });
  }
  return items;
});

const currentPageTitle = computed(() => {
  const item = navItems.value.find((i) => route.path.startsWith(i.path));
  if (route.path === "/profile") return "个人信息";
  if (route.path.startsWith("/workspace")) return "工作空间设置";
  return item?.label ?? "";
});

function isActive(path: string) {
  return route.path.startsWith(path);
}

function switchWorkspace(id: number) {
  wsStore.select(id);
  wsDropdownOpen.value = false;
  window.location.reload();
}

async function handleSyncPlane() {
  await wsStore.sync();
  wsDropdownOpen.value = false;
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
