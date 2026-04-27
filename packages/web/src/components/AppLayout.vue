<template>
  <div class="flex min-h-screen" style="background-color: var(--color-bg-primary)">
    <!-- Sidebar -->
    <nav
      class="shrink-0 flex flex-col transition-all duration-150"
      :style="{
        width: sidebarCollapsed ? '0px' : '224px',
        overflow: sidebarCollapsed ? 'hidden' : 'visible',
        backgroundColor: 'var(--color-bg-panel)',
        borderRight: sidebarCollapsed ? 'none' : '1px solid var(--color-border-subtle)',
      }"
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
                color: var(--color-text-secondary);
                transition: all 120ms ease;
              "
              @click="handleCreateWorkspace"
            >
              + 新建工作空间
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

      <!-- Plane Navigation -->
      <div v-if="planeNavItems.length > 0" class="px-2 mt-1">
        <div
          class="px-3 py-1 text-xs uppercase"
          style="font-weight: 510; color: var(--color-text-quaternary); letter-spacing: 0.05em"
        >
          项目管理
        </div>
        <ul class="list-none p-0 m-0">
          <li v-for="item in planeNavItems" :key="item.url">
            <a
              :href="item.url"
              class="flex items-center gap-2.5 px-3 py-1.5 rounded-md no-underline text-sm my-0.5 nav-default"
              style="transition: all 120ms ease"
              target="_blank"
            >
              <component :is="item.icon" :size="16" style="opacity: 0.6" />
              {{ item.label }}
              <ExternalLink :size="12" style="opacity: 0.3; margin-left: auto" />
            </a>
          </li>
        </ul>
      </div>

      <!-- User -->
      <div
        class="px-3 py-3 flex items-center gap-2.5"
        style="border-top: 1px solid var(--color-border-subtle)"
      >
        <!-- Theme toggle -->
        <button
          class="w-7 h-7 rounded-md flex items-center justify-center shrink-0 cursor-pointer"
          style="
            background: var(--color-surface-05);
            border: none;
            color: var(--color-text-tertiary);
            transition: all 120ms ease;
          "
          title="切换亮/暗模式"
          @click="themeStore.toggle()"
        >
          <Sun v-if="themeStore.theme === 'dark'" :size="14" />
          <Moon v-else :size="14" />
        </button>
      </div>
      <div
        class="px-3 pb-3 pt-0 flex items-center gap-2.5 cursor-pointer"
        style="transition: all 120ms ease"
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

    <!-- Create Workspace Dialog -->
    <UiDialog v-model:open="showCreateWsDialog">
      <div class="mb-4">
        <h2 style="font-weight: 590; color: var(--color-text-primary); font-size: 15px; margin: 0">
          新建工作空间
        </h2>
      </div>
      <input
        ref="wsNameInput"
        v-model="newWsName"
        placeholder="工作空间名称"
        class="w-full px-3 py-2 rounded-md text-sm"
        style="
          background-color: var(--color-bg-primary);
          border: 1px solid var(--color-border-default);
          color: var(--color-text-primary);
          outline: none;
        "
        @keydown.enter="confirmCreateWorkspace"
      />
      <div class="flex justify-end gap-2 mt-4">
        <button class="dialog-btn" @click="showCreateWsDialog = false">取消</button>
        <button class="dialog-btn-primary" @click="confirmCreateWorkspace">创建</button>
      </div>
    </UiDialog>

    <!-- Main -->
    <div class="flex-1 flex flex-col min-w-0">
      <!-- Header -->
      <header
        class="h-12 flex items-center justify-between px-4 shrink-0"
        style="border-bottom: 1px solid var(--color-border-subtle)"
      >
        <div class="flex items-center gap-2">
          <button
            class="w-7 h-7 rounded-md flex items-center justify-center shrink-0 cursor-pointer"
            style="
              background: none;
              border: none;
              color: var(--color-text-quaternary);
              transition: all 120ms ease;
            "
            title="折叠侧边栏"
            @click="sidebarCollapsed = !sidebarCollapsed"
          >
            <PanelLeft :size="16" />
          </button>
          <div class="text-xs" style="color: var(--color-text-tertiary); font-weight: 510">
            <span style="color: var(--color-text-quaternary)">ArcFlow /</span>
            {{ currentPageTitle }}
          </div>
        </div>
      </header>

      <!-- Content -->
      <main class="flex-1 overflow-y-auto" :class="isFullWidthPage ? '' : 'p-8'">
        <div :class="isFullWidthPage ? 'h-full' : 'max-w-5xl mx-auto'">
          <router-view />
        </div>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, nextTick } from "vue";
import { useRoute } from "vue-router";
import { useAuthStore } from "../stores/auth";
import { useWorkspaceStore } from "../stores/workspace";
import {
  LayoutDashboard,
  MessageSquare,
  List,
  Settings,
  FileText,
  ListRestart,
  Sun,
  Moon,
  PanelLeft,
  ExternalLink,
  Kanban,
  CalendarDays,
  Package,
  BarChart3,
} from "lucide-vue-next";
import { useThemeStore } from "../stores/theme";
import UiDialog from "./ui/AppDialog.vue";
import { usePlaneUrl } from "../composables/usePlaneUrl";

const route = useRoute();
const auth = useAuthStore();
const wsStore = useWorkspaceStore();
const themeStore = useThemeStore();
const sidebarCollapsed = ref(false);
const wsDropdownOpen = ref(false);
const showCreateWsDialog = ref(false);
const newWsName = ref("");
const wsNameInput = ref<HTMLInputElement | null>(null);

const navItems = computed(() => {
  const items = [
    { path: "/dashboard", label: "仪表盘", icon: LayoutDashboard },
    { path: "/chat", label: "AI 对话", icon: MessageSquare },
    { path: "/docs", label: "文档", icon: FileText },
    { path: "/workflows", label: "工作流", icon: List },
    { path: "/webhook-jobs", label: "Webhook Jobs", icon: ListRestart },
  ];
  if (wsStore.isAdmin) {
    items.push({ path: "/workspace/settings", label: "工作空间设置", icon: Settings });
  }
  return items;
});

const { planeProjectBase, projectPath } = usePlaneUrl();

const planeNavItems = computed(() => {
  if (!planeProjectBase.value) return [];
  return [
    { label: "看板", icon: Kanban, url: projectPath("issues/")! },
    { label: "Cycles", icon: CalendarDays, url: projectPath("cycles/")! },
    { label: "Modules", icon: Package, url: projectPath("modules/")! },
    { label: "分析", icon: BarChart3, url: projectPath("analytics/")! },
  ];
});

const currentPageTitle = computed(() => {
  const item = navItems.value.find((i) => route.path.startsWith(i.path));
  if (route.path === "/profile") return "个人信息";
  if (route.path.startsWith("/workspace")) return "工作空间设置";
  return item?.label ?? "";
});

const isFullWidthPage = computed(
  () => route.path.startsWith("/docs") || route.path.startsWith("/chat"),
);

function isActive(path: string) {
  return route.path.startsWith(path);
}

function switchWorkspace(id: number) {
  wsStore.select(id);
  wsDropdownOpen.value = false;
  window.location.reload();
}

function handleCreateWorkspace() {
  newWsName.value = "";
  showCreateWsDialog.value = true;
  wsDropdownOpen.value = false;
  nextTick(() => wsNameInput.value?.focus());
}

async function confirmCreateWorkspace() {
  if (!newWsName.value.trim()) return;
  await wsStore.create(newWsName.value.trim());
  showCreateWsDialog.value = false;
  window.location.reload();
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
.dialog-btn {
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  border: 1px solid var(--color-border-default);
  background: none;
  color: var(--color-text-secondary);
  transition: all 120ms ease;
}
.dialog-btn:hover {
  background-color: var(--color-surface-05);
}
.dialog-btn-primary {
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  border: none;
  background-color: var(--color-accent);
  color: #fff;
  font-weight: 510;
  transition: all 120ms ease;
}
.dialog-btn-primary:hover {
  background-color: var(--color-accent-hover);
}
</style>
