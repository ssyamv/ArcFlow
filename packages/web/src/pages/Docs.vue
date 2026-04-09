<template>
  <div class="flex -m-8" style="height: calc(100vh - 48px)">
    <!-- File Tree Sidebar -->
    <div
      class="w-64 shrink-0 flex flex-col"
      style="
        background-color: var(--color-bg-panel);
        border-right: 1px solid var(--color-border-subtle);
      "
    >
      <!-- Search -->
      <div class="p-3" style="border-bottom: 1px solid var(--color-border-subtle)">
        <input
          v-model="searchInput"
          type="text"
          placeholder="搜索文档..."
          class="w-full px-2.5 py-1.5 rounded-md text-xs outline-none"
          style="
            background-color: var(--color-surface-02);
            border: 1px solid var(--color-border-default);
            color: var(--color-text-secondary);
          "
          @input="handleSearch"
        />
      </div>

      <!-- Search Results or File Tree -->
      <div class="flex-1 overflow-y-auto px-2 py-1">
        <!-- Search Results -->
        <template v-if="searchInput.trim()">
          <div class="tree-label">搜索结果</div>
          <div
            v-for="r in store.searchResults"
            :key="r.path"
            class="tree-item"
            @click="store.openFile(r.path)"
          >
            <span class="truncate">{{ r.name }}</span>
            <span class="tree-path">{{ r.path }}</span>
          </div>
          <div v-if="!store.searchResults.length" class="tree-empty">无结果</div>
        </template>

        <!-- File Tree -->
        <template v-else>
          <div class="tree-label">文档目录</div>
          <TreeItem
            v-for="node in store.tree"
            :key="node.path"
            :node="node"
            :depth="0"
            :active-path="store.currentPath"
            @select="handleFileSelect"
            @new-file="handleNewFileInDir"
            @new-folder="handleNewFolderInDir"
            @rename="handleRenameNode"
            @delete-node="handleDeleteNode"
          />
          <div v-if="!store.tree.length && !store.loading" class="tree-empty">暂无文档</div>
        </template>
      </div>

      <!-- New Button -->
      <div class="p-2" style="border-top: 1px solid var(--color-border-subtle)">
        <div class="flex gap-1.5">
          <button class="new-btn flex-1" @click="showNewFileDialog = true">+ 文件</button>
          <button class="new-btn flex-1" @click="showNewFolderDialog = true">+ 文件夹</button>
        </div>
      </div>
    </div>

    <!-- Editor Area -->
    <div class="flex-1 flex flex-col min-w-0">
      <!-- Toolbar -->
      <div
        v-if="store.currentPath"
        class="px-4 py-2 flex items-center justify-between shrink-0"
        style="border-bottom: 1px solid var(--color-border-subtle)"
      >
        <div class="flex items-center gap-1 text-xs" style="color: var(--color-text-tertiary)">
          <span v-for="(seg, i) in breadcrumbs" :key="i">
            <span v-if="i > 0" style="color: var(--color-text-quaternary)"> / </span>
            <span
              :style="{
                color:
                  i === breadcrumbs.length - 1
                    ? 'var(--color-text-primary)'
                    : 'var(--color-text-quaternary)',
                fontWeight: i === breadcrumbs.length - 1 ? 510 : 400,
              }"
              >{{ seg }}</span
            >
          </span>
          <span
            v-if="store.isDirty"
            class="w-2 h-2 rounded-full ml-2"
            style="background-color: var(--color-accent)"
          />
        </div>
        <div class="flex items-center gap-2">
          <button class="save-btn" :disabled="!store.isDirty || store.saving" @click="handleSave">
            {{ store.saving ? "保存中..." : "保存" }}
          </button>
        </div>
      </div>

      <!-- Tiptap Editor -->
      <div v-if="store.currentPath" class="flex-1 overflow-y-auto">
        <editor-content :editor="editor" class="docs-editor" />
      </div>

      <!-- Empty State -->
      <div v-else class="flex-1 flex items-center justify-center">
        <div class="text-center">
          <div class="text-sm mb-2" style="font-weight: 510; color: var(--color-text-tertiary)">
            选择一个文档开始编辑
          </div>
          <div class="text-xs" style="color: var(--color-text-quaternary)">
            从左侧文件树中选择，或创建新文档
          </div>
        </div>
      </div>
    </div>

    <!-- New File Dialog -->
    <Teleport to="body">
      <div v-if="showNewFileDialog" class="dialog-overlay" @click.self="showNewFileDialog = false">
        <div class="dialog-box">
          <div class="dialog-title">新建文档</div>
          <input
            v-model="newFilePath"
            class="dialog-input"
            placeholder="文件路径，如 prd/new-feature.md"
            @keyup.enter="confirmNewFile"
          />
          <div class="dialog-actions">
            <button class="dialog-cancel" @click="showNewFileDialog = false">取消</button>
            <button class="dialog-confirm" @click="confirmNewFile">创建</button>
          </div>
        </div>
      </div>

      <div
        v-if="showNewFolderDialog"
        class="dialog-overlay"
        @click.self="showNewFolderDialog = false"
      >
        <div class="dialog-box">
          <div class="dialog-title">新建文件夹</div>
          <input
            v-model="newFolderPath"
            class="dialog-input"
            placeholder="文件夹路径，如 tech-design"
            @keyup.enter="confirmNewFolder"
          />
          <div class="dialog-actions">
            <button class="dialog-cancel" @click="showNewFolderDialog = false">取消</button>
            <button class="dialog-confirm" @click="confirmNewFolder">创建</button>
          </div>
        </div>
      </div>

      <div v-if="showRenameDialog" class="dialog-overlay" @click.self="showRenameDialog = false">
        <div class="dialog-box">
          <div class="dialog-title">重命名</div>
          <input
            v-model="renamePath"
            class="dialog-input"
            placeholder="新路径"
            @keyup.enter="confirmRename"
          />
          <div class="dialog-actions">
            <button class="dialog-cancel" @click="showRenameDialog = false">取消</button>
            <button class="dialog-confirm" @click="confirmRename">确认</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from "vue";
import { useEditor, EditorContent } from "@tiptap/vue-3";
import StarterKit from "@tiptap/starter-kit";
import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { marked } from "marked";
import TurndownService from "turndown";
import { useDocsStore } from "../stores/docs";
import TreeItem from "../components/DocTreeItem.vue";

defineOptions({ name: "DocsPage" });

const store = useDocsStore();
const searchInput = ref("");
const showNewFileDialog = ref(false);
const showNewFolderDialog = ref(false);
const showRenameDialog = ref(false);
const newFilePath = ref("");
const newFolderPath = ref("");
const renamePath = ref("");
const renameOldPath = ref("");

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

const editor = useEditor({
  extensions: [
    StarterKit,
    Table.configure({ resizable: true }),
    TableRow,
    TableCell,
    TableHeader,
    TaskList,
    TaskItem.configure({ nested: true }),
  ],
  editorProps: {
    attributes: {
      class: "prose prose-invert max-w-none px-8 py-6 outline-none",
    },
  },
  onUpdate: ({ editor: e }) => {
    const html = e.getHTML();
    const md = turndown.turndown(html);
    store.setContent(md);
  },
});

const breadcrumbs = computed(() => store.currentPath?.split("/") ?? []);

let searchTimeout: ReturnType<typeof setTimeout>;
function handleSearch() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    store.search(searchInput.value);
  }, 300);
}

async function handleFileSelect(path: string) {
  if (store.isDirty) {
    if (!confirm("当前文档未保存，是否放弃修改？")) return;
  }
  await store.openFile(path);
}

watch(
  () => store.currentContent,
  (newContent) => {
    if (!editor.value) return;
    // Only set content when file is freshly loaded (not dirty)
    if (!store.isDirty || store.currentContent === store.originalContent) {
      const html = marked.parse(newContent) as string;
      editor.value.commands.setContent(html);
    }
  },
  { immediate: false },
);

// When a new file is opened, update editor
watch(
  () => store.currentPath,
  async () => {
    if (!editor.value || !store.currentPath) return;
    const html = marked.parse(store.currentContent) as string;
    editor.value.commands.setContent(html);
  },
);

async function handleSave() {
  await store.saveFile();
}

async function confirmNewFile() {
  if (!newFilePath.value.trim()) return;
  const path = newFilePath.value.endsWith(".md") ? newFilePath.value : `${newFilePath.value}.md`;
  await store.createNewFile(path, `# ${path.split("/").pop()?.replace(".md", "")}\n`);
  showNewFileDialog.value = false;
  newFilePath.value = "";
}

async function confirmNewFolder() {
  if (!newFolderPath.value.trim()) return;
  await store.createNewFolder(newFolderPath.value);
  showNewFolderDialog.value = false;
  newFolderPath.value = "";
}

function handleNewFileInDir(dirPath: string) {
  newFilePath.value = `${dirPath}/`;
  showNewFileDialog.value = true;
}

function handleNewFolderInDir(dirPath: string) {
  newFolderPath.value = `${dirPath}/`;
  showNewFolderDialog.value = true;
}

function handleRenameNode(path: string) {
  renameOldPath.value = path;
  renamePath.value = path;
  showRenameDialog.value = true;
}

async function confirmRename() {
  if (!renamePath.value.trim() || renamePath.value === renameOldPath.value) return;
  if (store.currentPath === renameOldPath.value) {
    await store.renameCurrentFile(renamePath.value);
  } else {
    const { renameDoc } = await import("../api/docs");
    await renameDoc(renameOldPath.value, renamePath.value);
    await store.loadTree();
  }
  showRenameDialog.value = false;
  renamePath.value = "";
  renameOldPath.value = "";
}

async function handleDeleteNode(path: string) {
  if (!confirm(`确定删除 ${path}？`)) return;
  if (store.currentPath === path) {
    await store.deleteCurrentFile();
  } else {
    const { deleteFile } = await import("../api/docs");
    await deleteFile(path);
    await store.loadTree();
  }
}

// Warn before leaving with unsaved changes
function handleBeforeUnload(e: BeforeUnloadEvent) {
  if (store.isDirty) {
    e.preventDefault();
  }
}

onMounted(() => {
  store.loadTree();
  window.addEventListener("beforeunload", handleBeforeUnload);
});

onBeforeUnmount(() => {
  window.removeEventListener("beforeunload", handleBeforeUnload);
  editor.value?.destroy();
});
</script>

<style scoped>
.tree-label {
  padding: 4px 8px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--color-text-quaternary);
  font-weight: 510;
  margin-bottom: 2px;
}

.tree-item {
  display: flex;
  flex-direction: column;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  color: var(--color-text-secondary);
  font-weight: 510;
  transition: all 120ms ease;
}

.tree-item:hover {
  background-color: var(--color-surface-03);
}

.tree-path {
  font-size: 10px;
  color: var(--color-text-quaternary);
  font-weight: 400;
}

.tree-empty {
  padding: 12px 8px;
  font-size: 12px;
  color: var(--color-text-quaternary);
  text-align: center;
}

.new-btn {
  padding: 5px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 510;
  cursor: pointer;
  border: 1px solid var(--color-border-default);
  background-color: var(--color-surface-02);
  color: var(--color-text-secondary);
  transition: all 120ms ease;
}

.new-btn:hover {
  background-color: var(--color-surface-05);
  color: var(--color-text-primary);
}

.save-btn {
  padding: 3px 12px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 510;
  cursor: pointer;
  border: none;
  background-color: var(--color-accent);
  color: white;
  transition: all 120ms ease;
}

.save-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.dialog-box {
  background-color: var(--color-bg-surface);
  border: 1px solid var(--color-border-default);
  border-radius: 12px;
  padding: 20px;
  width: 400px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
}

.dialog-title {
  font-size: 14px;
  font-weight: 510;
  color: var(--color-text-primary);
  margin-bottom: 12px;
}

.dialog-input {
  width: 100%;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--color-border-default);
  background-color: var(--color-surface-02);
  color: var(--color-text-primary);
  font-size: 13px;
  outline: none;
  box-sizing: border-box;
}

.dialog-input:focus {
  border-color: var(--color-accent);
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.dialog-cancel {
  padding: 5px 14px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 510;
  cursor: pointer;
  border: 1px solid var(--color-border-default);
  background: none;
  color: var(--color-text-secondary);
}

.dialog-confirm {
  padding: 5px 14px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 510;
  cursor: pointer;
  border: none;
  background-color: var(--color-accent);
  color: white;
}
</style>

<style>
/* Tiptap editor global styles */
.docs-editor .ProseMirror {
  min-height: calc(100vh - 120px);
  padding: 24px 32px;
  color: var(--color-text-primary);
  font-size: 14px;
  line-height: 1.7;
}

.docs-editor .ProseMirror:focus {
  outline: none;
}

.docs-editor .ProseMirror h1 {
  font-size: 24px;
  font-weight: 600;
  margin: 24px 0 8px;
  color: var(--color-text-primary);
}

.docs-editor .ProseMirror h2 {
  font-size: 20px;
  font-weight: 600;
  margin: 20px 0 6px;
  color: var(--color-text-primary);
}

.docs-editor .ProseMirror h3 {
  font-size: 16px;
  font-weight: 510;
  margin: 16px 0 4px;
  color: var(--color-text-primary);
}

.docs-editor .ProseMirror p {
  margin: 4px 0;
  color: var(--color-text-secondary);
}

.docs-editor .ProseMirror ul,
.docs-editor .ProseMirror ol {
  padding-left: 24px;
  color: var(--color-text-secondary);
}

.docs-editor .ProseMirror code {
  background-color: var(--color-surface-05);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 13px;
}

.docs-editor .ProseMirror pre {
  background-color: var(--color-surface-02);
  border: 1px solid var(--color-border-default);
  border-radius: 8px;
  padding: 16px;
  overflow-x: auto;
}

.docs-editor .ProseMirror pre code {
  background: none;
  padding: 0;
}

.docs-editor .ProseMirror blockquote {
  border-left: 3px solid var(--color-accent);
  padding-left: 16px;
  margin-left: 0;
  color: var(--color-text-tertiary);
}

.docs-editor .ProseMirror table {
  border-collapse: collapse;
  width: 100%;
  margin: 12px 0;
}

.docs-editor .ProseMirror th,
.docs-editor .ProseMirror td {
  border: 1px solid var(--color-border-default);
  padding: 8px 12px;
  font-size: 13px;
}

.docs-editor .ProseMirror th {
  background-color: var(--color-surface-02);
  font-weight: 510;
}

.docs-editor .ProseMirror ul[data-type="taskList"] {
  list-style: none;
  padding-left: 4px;
}

.docs-editor .ProseMirror ul[data-type="taskList"] li {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.docs-editor .ProseMirror ul[data-type="taskList"] li label {
  margin-top: 3px;
}
</style>
