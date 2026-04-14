<template>
  <div
    class="min-h-screen flex items-center justify-center px-4"
    style="background-color: var(--color-bg-primary)"
  >
    <div
      class="w-full max-w-md rounded-lg border p-6"
      style="background-color: var(--color-bg-secondary); border-color: var(--color-border-primary)"
    >
      <h1 class="text-lg font-semibold mb-4" style="color: var(--color-text-primary)">
        需求草稿审批
      </h1>

      <div v-if="phase === 'loading'" class="text-sm" style="color: var(--color-text-tertiary)">
        正在验证审批链接...
      </div>

      <div v-else-if="phase === 'invalid'" class="space-y-3">
        <p class="text-sm" style="color: var(--color-error-light)">
          {{ invalidMessage }}
        </p>
        <button
          class="text-xs underline"
          style="color: var(--color-text-tertiary)"
          @click="goDashboard"
        >
          返回首页
        </button>
      </div>

      <div v-else-if="phase === 'confirm' && payload" class="space-y-4">
        <div class="text-sm space-y-1" style="color: var(--color-text-secondary)">
          <p>
            即将对
            <span style="color: var(--color-text-primary)">
              {{ resourceLabel(payload.resource_type) }} #{{ payload.resource_id }}
            </span>
            执行
            <span :class="payload.action === 'approve' ? 'text-green-600' : 'text-red-600'">
              {{ payload.action === "approve" ? "通过" : "驳回" }}
            </span>
            操作。
          </p>
          <p class="text-xs" style="color: var(--color-text-tertiary)">
            此链接 15 分钟内有效，且只能使用一次。
          </p>
        </div>

        <textarea
          v-model="note"
          rows="3"
          placeholder="可选：补充一句说明（会记录在审批日志里）"
          class="w-full rounded-md border px-3 py-2 text-sm"
          style="
            background-color: var(--color-bg-primary);
            border-color: var(--color-border-primary);
            color: var(--color-text-primary);
          "
        />

        <div class="flex items-center justify-end gap-2">
          <button
            type="button"
            class="rounded-md px-3 py-1.5 text-sm border"
            style="border-color: var(--color-border-primary); color: var(--color-text-secondary)"
            :disabled="submitting"
            @click="goDashboard"
          >
            取消
          </button>
          <button
            type="button"
            class="rounded-md px-3 py-1.5 text-sm text-white"
            :style="{
              backgroundColor: payload.action === 'approve' ? 'rgb(22 163 74)' : 'rgb(220 38 38)',
              opacity: submitting ? 0.6 : 1,
            }"
            :disabled="submitting"
            @click="confirm"
          >
            {{ submitting ? "提交中..." : payload.action === "approve" ? "确认通过" : "确认驳回" }}
          </button>
        </div>
      </div>

      <div v-else-if="phase === 'done'" class="space-y-3">
        <p class="text-sm" style="color: var(--color-text-primary)">✅ 已完成：{{ doneLabel }}</p>
        <button
          class="text-xs underline"
          style="color: var(--color-text-tertiary)"
          @click="goDashboard"
        >
          返回首页
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";
import { executeApproval, verifyApproval, type ApprovalPayload } from "../api/approval";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

type Phase = "loading" | "invalid" | "confirm" | "done";
const phase = ref<Phase>("loading");
const payload = ref<ApprovalPayload | null>(null);
const invalidMessage = ref("");
const note = ref("");
const submitting = ref(false);
const doneLabel = ref("");

const token = computed(() => (route.params.token as string) ?? "");

function resourceLabel(type: string): string {
  if (type === "requirement_draft") return "需求草稿";
  return type;
}

function mapErrorCode(code: string, fallback: string): string {
  switch (code) {
    case "expired":
      return "审批链接已过期（超过 15 分钟）。请回到需求详情页重新发起审批。";
    case "already_consumed":
      return "该审批链接已被使用过，不能重复操作。";
    case "user_mismatch":
      return "当前登录账号与审批链接指向的用户不一致，请换号后重试。";
    case "malformed":
    case "invalid":
      return "审批链接无效或损坏。";
    default:
      return fallback;
  }
}

function goDashboard(): void {
  router.replace("/dashboard");
}

async function confirm(): Promise<void> {
  if (!token.value || !auth.token) return;
  submitting.value = true;
  const result = await executeApproval(token.value, auth.token, note.value || undefined);
  submitting.value = false;
  if (!result.ok) {
    phase.value = "invalid";
    invalidMessage.value = mapErrorCode(result.code, result.error);
    return;
  }
  doneLabel.value = `${resourceLabel(result.resource.type)} #${result.resource.id} 已${
    result.action === "approve" ? "通过" : "驳回"
  }。`;
  phase.value = "done";
}

onMounted(async () => {
  if (!token.value) {
    invalidMessage.value = "缺少审批 token。";
    phase.value = "invalid";
    return;
  }
  if (!auth.token) {
    // Not logged in — bounce to login, round-trip back after auth.
    router.replace({
      name: "login",
      query: { redirect: route.fullPath },
    });
    return;
  }
  const result = await verifyApproval(token.value);
  if (!result.ok) {
    invalidMessage.value = mapErrorCode(result.code, result.error);
    phase.value = "invalid";
    return;
  }
  payload.value = result.payload;
  phase.value = "confirm";
});
</script>
