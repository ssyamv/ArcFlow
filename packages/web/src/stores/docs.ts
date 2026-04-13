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

/**
 * 分离 YAML frontmatter（Wiki.js 遗留的元数据块）和正文内容。
 * 支持两种格式：
 * 1. 标准 frontmatter: --- 开头，到第二个 --- 结束
 * 2. Wiki.js 损坏格式: * * * 开头，紧跟 ## title: ... dateCreated: ... 行
 */
function splitFrontmatter(raw: string): { frontmatter: string; body: string } {
  // 标准 frontmatter
  const stdMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (stdMatch) return { frontmatter: `---\n${stdMatch[1]}\n---\n`, body: stdMatch[2] };

  // Wiki.js 损坏格式: "* * *\n\n## title: ... dateCreated: ...\n\n..."
  const wikiMatch = raw.match(
    /^\* \* \*\r?\n\r?\n##\s+title:.*?dateCreated:.*?\r?\n\r?\n([\s\S]*)$/,
  );
  if (wikiMatch) return { frontmatter: "", body: wikiMatch[1] };

  return { frontmatter: "", body: raw };
}

function joinFrontmatter(frontmatter: string, body: string): string {
  if (!frontmatter) return body;
  return frontmatter + body;
}

export const useDocsStore = defineStore("docs", () => {
  const tree = ref<TreeNode[]>([]);
  const currentPath = ref<string | null>(null);
  const currentContent = ref("");
  const originalContent = ref("");
  /** 当前文件的 frontmatter（编辑器不显示，保存时自动拼回） */
  const currentFrontmatter = ref("");
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
    // 立即切换路径并清空内容，让 UI 马上显示 loading
    currentPath.value = path;
    currentContent.value = "";
    originalContent.value = "";
    currentFrontmatter.value = "";
    loading.value = true;
    try {
      const res = await fetchFile(path);
      // 防止加载完成时用户已切换到其他文件
      if (currentPath.value !== path) return;
      const { frontmatter, body } = splitFrontmatter(res.content);
      currentFrontmatter.value = frontmatter;
      currentContent.value = body;
      originalContent.value = body;
    } finally {
      loading.value = false;
    }
  }

  async function saveFile() {
    if (!currentPath.value || !isDirty.value) return;
    saving.value = true;
    try {
      const fullContent = joinFrontmatter(currentFrontmatter.value, currentContent.value);
      await updateFile(currentPath.value, fullContent);
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
    currentFrontmatter.value = "";
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
