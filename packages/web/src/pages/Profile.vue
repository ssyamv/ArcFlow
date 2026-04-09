<template>
  <div>
    <h1
      class="text-2xl mb-6"
      style="font-weight: 510; color: var(--color-text-primary); letter-spacing: -0.288px"
    >
      个人信息
    </h1>

    <div
      class="max-w-xl rounded-lg p-6"
      style="
        background-color: var(--color-surface-02);
        border: 1px solid var(--color-border-default);
      "
    >
      <!-- Avatar + Name -->
      <div
        class="flex items-center gap-4 mb-6 pb-6"
        style="border-bottom: 1px solid var(--color-border-subtle)"
      >
        <div
          class="w-16 h-16 rounded-full flex items-center justify-center text-xl shrink-0"
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
        <div>
          <div class="text-lg" style="font-weight: 510; color: var(--color-text-primary)">
            {{ auth.user?.name }}
          </div>
          <span
            class="text-xs px-2 py-0.5 rounded-full"
            style="
              border: 1px solid var(--color-border-solid);
              color: var(--color-text-secondary);
              font-weight: 510;
            "
          >
            {{ auth.user?.role }}
          </span>
        </div>
      </div>

      <!-- Info Fields -->
      <div class="mb-6">
        <div
          class="text-xs uppercase mb-3"
          style="font-weight: 510; color: var(--color-text-quaternary); letter-spacing: 0.05em"
        >
          基本信息
        </div>
        <div class="space-y-3">
          <div v-for="field in infoFields" :key="field.label" class="flex items-center gap-3">
            <span
              class="text-xs shrink-0"
              style="font-weight: 510; color: var(--color-text-quaternary); width: 80px"
              >{{ field.label }}</span
            >
            <span class="text-sm" style="color: var(--color-text-secondary)">{{
              field.value
            }}</span>
          </div>
        </div>
      </div>

      <!-- Preferences -->
      <div class="mb-6 pb-6" style="border-bottom: 1px solid var(--color-border-subtle)">
        <div
          class="text-xs uppercase mb-3"
          style="font-weight: 510; color: var(--color-text-quaternary); letter-spacing: 0.05em"
        >
          偏好设置
        </div>
        <div class="flex items-center gap-3">
          <span
            class="text-xs"
            style="font-weight: 510; color: var(--color-text-quaternary); width: 80px"
            >主题</span
          >
          <span class="text-sm" style="color: var(--color-text-secondary)">暗色模式</span>
        </div>
      </div>

      <!-- Logout -->
      <button
        class="text-sm cursor-pointer px-3 py-1.5 rounded-md"
        style="
          background: none;
          border: 1px solid rgba(239, 68, 68, 0.3);
          color: var(--color-error-light);
          font-weight: 510;
          transition: all 120ms ease;
        "
        @click="handleLogout"
      >
        退出登录
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";

defineOptions({ name: "UserProfile" });

const router = useRouter();
const auth = useAuthStore();

const infoFields = computed(() => [
  { label: "邮箱", value: auth.user?.email ?? "未设置" },
  { label: "飞书 ID", value: auth.user?.feishu_user_id ?? "-" },
  { label: "注册时间", value: auth.user?.created_at ?? "-" },
  { label: "最近登录", value: auth.user?.last_login_at ?? "-" },
]);

function handleLogout() {
  auth.logout();
  router.push("/login");
}
</script>
