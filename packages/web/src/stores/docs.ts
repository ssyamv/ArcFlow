import { defineStore } from "pinia";
import { ref, computed } from "vue";
import {
  fetchTree,
  fetchFile,
  updateFile,
  createFile,
  deleteFile,
  createFolder,
  renameDoc,
  searchDocs,
  type TreeNode,
  type SearchResult,
} from "../api/docs";

export const useDocsStore = defineStore("docs", () => {
  const tree = ref<TreeNode[]>([]);
  const currentPath = ref<string | null>(null);
  const currentContent = ref("");
  const originalContent = ref("");
  const loading = ref(false);
  const saving = ref(false);
  const searchQuery = ref("");
  const searchResults = ref<SearchResult[]>([]);

  const isDirty = computed(() => currentContent.value !== originalContent.value);
  const currentFileName = computed(() => {
    if (!currentPath.value) return null;
    return currentPath.value.split("/").pop() ?? null;
  });

  async function loadTree() {
    loading.value = true;
    try {
      const res = await fetchTree();
      tree.value = res.data;
    } finally {
      loading.value = false;
    }
  }

  async function openFile(path: string) {
    loading.value = true;
    try {
      const res = await fetchFile(path);
      currentPath.value = path;
      currentContent.value = res.content;
      originalContent.value = res.content;
    } finally {
      loading.value = false;
    }
  }

  async function saveFile() {
    if (!currentPath.value || !isDirty.value) return;
    saving.value = true;
    try {
      await updateFile(currentPath.value, currentContent.value);
      originalContent.value = currentContent.value;
    } finally {
      saving.value = false;
    }
  }

  async function createNewFile(path: string, content: string = "") {
    await createFile(path, content);
    await loadTree();
    await openFile(path);
  }

  async function deleteCurrentFile() {
    if (!currentPath.value) return;
    await deleteFile(currentPath.value);
    currentPath.value = null;
    currentContent.value = "";
    originalContent.value = "";
    await loadTree();
  }

  async function createNewFolder(path: string) {
    await createFolder(path);
    await loadTree();
  }

  async function renameCurrentFile(newPath: string) {
    if (!currentPath.value) return;
    await renameDoc(currentPath.value, newPath);
    currentPath.value = newPath;
    await loadTree();
  }

  async function search(q: string) {
    searchQuery.value = q;
    if (!q.trim()) {
      searchResults.value = [];
      return;
    }
    const res = await searchDocs(q);
    searchResults.value = res.data;
  }

  function setContent(content: string) {
    currentContent.value = content;
  }

  function closeFile() {
    currentPath.value = null;
    currentContent.value = "";
    originalContent.value = "";
  }

  return {
    tree,
    currentPath,
    currentContent,
    originalContent,
    loading,
    saving,
    searchQuery,
    searchResults,
    isDirty,
    currentFileName,
    loadTree,
    openFile,
    saveFile,
    createNewFile,
    deleteCurrentFile,
    createNewFolder,
    renameCurrentFile,
    search,
    setContent,
    closeFile,
  };
});
