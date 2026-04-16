<template>
  <div class="rounded-md border p-3" style="border-color: var(--color-border-subtle)">
    <div class="text-sm font-medium mb-2">{{ artifact.title }}</div>
    <template v-if="parsed">
      <div v-for="field in parsed.fields ?? []" :key="field.label" class="text-xs mb-1">
        <span style="color: var(--color-text-tertiary)">{{ field.label }}：</span>
        <span>{{ field.value }}</span>
      </div>
      <div class="flex gap-2 mt-2">
        <a
          v-for="action in parsed.actions ?? []"
          :key="action.url"
          :href="action.url"
          class="text-xs no-underline px-2 py-1 rounded"
          style="background-color: var(--color-surface-05); color: var(--color-text-primary)"
        >
          {{ action.label }}
        </a>
      </div>
    </template>
    <pre v-else class="whitespace-pre-wrap text-xs">{{ artifact.content }}</pre>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

defineOptions({ name: "AiArtifactCard" });

const props = defineProps<{
  artifact: { id: string; type: string; title: string; content: string };
}>();

const parsed = computed(() => {
  try {
    return JSON.parse(props.artifact.content) as {
      fields?: Array<{ label: string; value: string }>;
      actions?: Array<{ label: string; url: string }>;
    };
  } catch {
    return null;
  }
});
</script>
