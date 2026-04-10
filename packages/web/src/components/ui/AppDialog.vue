<template>
  <DialogRoot v-bind="rootProps">
    <slot name="trigger" />
    <DialogPortal>
      <DialogOverlay class="dialog-overlay" />
      <DialogContent class="dialog-content" @escape-key-down="$emit('update:open', false)">
        <slot />
        <DialogClose as-child>
          <button class="dialog-close" aria-label="Close">
            <X :size="16" />
          </button>
        </DialogClose>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<script setup lang="ts">
import { DialogRoot, DialogPortal, DialogOverlay, DialogContent, DialogClose } from "radix-vue";
import { X } from "lucide-vue-next";
import { computed } from "vue";

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
}>();

const rootProps = computed(() => ({
  open: props.open,
  "onUpdate:open": (v: boolean) => emit("update:open", v),
}));
</script>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  background-color: var(--color-overlay);
  z-index: 50;
  animation: fadeIn 150ms ease;
}

.dialog-content {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 51;
  width: 100%;
  max-width: 400px;
  background-color: var(--color-bg-surface);
  border: 1px solid var(--color-border-default);
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.3);
  animation: contentIn 150ms ease;
}

.dialog-close {
  position: absolute;
  top: 16px;
  right: 16px;
  background: none;
  border: none;
  color: var(--color-text-quaternary);
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 120ms ease;
}

.dialog-close:hover {
  color: var(--color-text-secondary);
  background-color: var(--color-surface-05);
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes contentIn {
  from {
    opacity: 0;
    transform: translate(-50%, -48%) scale(0.96);
  }
  to {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
}
</style>
