<template>
  <div>
    <!-- Directory -->
    <div
      v-if="node.type === 'directory'"
      class="tree-node"
      :style="{ paddingLeft: `${depth * 16 + 8}px` }"
      @click="expanded = !expanded"
      @contextmenu.prevent="showCtx = true"
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        style="opacity: 0.4; transition: transform 120ms"
        :style="{ transform: expanded ? 'rotate(90deg)' : '' }"
      >
        <path d="M9 18l6-6-6-6" />
      </svg>
      <span class="truncate">{{ node.name }}</span>

      <!-- Context menu -->
      <div v-if="showCtx" class="ctx-menu" @click.stop>
        <div
          class="ctx-item"
          @click="
            $emit('newFile', node.path);
            showCtx = false;
          "
        >
          新建文件
        </div>
        <div
          class="ctx-item"
          @click="
            $emit('newFolder', node.path);
            showCtx = false;
          "
        >
          新建子文件夹
        </div>
        <div
          class="ctx-item"
          @click="
            $emit('rename', node.path);
            showCtx = false;
          "
        >
          重命名
        </div>
        <div
          class="ctx-item ctx-danger"
          @click="
            $emit('deleteNode', node.path);
            showCtx = false;
          "
        >
          删除
        </div>
      </div>
    </div>

    <!-- Children -->
    <template v-if="node.type === 'directory' && expanded">
      <TreeItem
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :depth="depth + 1"
        :active-path="activePath"
        @select="$emit('select', $event)"
        @new-file="$emit('newFile', $event)"
        @new-folder="$emit('newFolder', $event)"
        @rename="$emit('rename', $event)"
        @delete-node="$emit('deleteNode', $event)"
      />
    </template>

    <!-- File -->
    <div
      v-if="node.type === 'file'"
      class="tree-node"
      :style="{
        paddingLeft: `${depth * 16 + 28}px`,
        backgroundColor: activePath === node.path ? 'var(--color-surface-05)' : 'transparent',
        color:
          activePath === node.path ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
      }"
      @click="$emit('select', node.path)"
      @contextmenu.prevent="showCtx = true"
    >
      <span class="truncate">{{ node.name }}</span>

      <!-- Context menu -->
      <div v-if="showCtx" class="ctx-menu" @click.stop>
        <div
          class="ctx-item"
          @click="
            $emit('rename', node.path);
            showCtx = false;
          "
        >
          重命名
        </div>
        <div
          class="ctx-item ctx-danger"
          @click="
            $emit('deleteNode', node.path);
            showCtx = false;
          "
        >
          删除
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from "vue";
import type { TreeNode } from "../api/docs";

defineOptions({ name: "TreeItem" });

defineProps<{
  node: TreeNode;
  depth: number;
  activePath: string | null;
}>();

defineEmits<{
  select: [path: string];
  newFile: [dirPath: string];
  newFolder: [dirPath: string];
  rename: [path: string];
  deleteNode: [path: string];
}>();

const expanded = ref(false);
const showCtx = ref(false);

function closeCtx() {
  showCtx.value = false;
}

onMounted(() => document.addEventListener("click", closeCtx));
onBeforeUnmount(() => document.removeEventListener("click", closeCtx));
</script>

<style scoped>
.tree-node {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 510;
  color: var(--color-text-secondary);
  transition: all 120ms ease;
  position: relative;
  user-select: none;
}

.tree-node:hover {
  background-color: var(--color-surface-03);
}

.ctx-menu {
  position: absolute;
  top: 100%;
  left: 16px;
  background-color: var(--color-bg-surface);
  border: 1px solid var(--color-border-default);
  border-radius: 8px;
  padding: 4px;
  z-index: 50;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  min-width: 120px;
}

.ctx-item {
  padding: 5px 10px;
  font-size: 12px;
  font-weight: 510;
  color: var(--color-text-secondary);
  border-radius: 4px;
  cursor: pointer;
  transition: all 120ms ease;
}

.ctx-item:hover {
  background-color: var(--color-surface-05);
  color: var(--color-text-primary);
}

.ctx-danger:hover {
  background-color: rgba(239, 68, 68, 0.15);
  color: var(--color-error);
}
</style>
