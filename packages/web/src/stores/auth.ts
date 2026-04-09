import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { fetchMe, type User } from "../api/auth";

const TOKEN_KEY = "arcflow_token";

export const useAuthStore = defineStore("auth", () => {
  const user = ref<User | null>(null);
  const token = ref<string | null>(localStorage.getItem(TOKEN_KEY));
  const loading = ref(false);

  const isAuthenticated = computed(() => !!token.value);

  function setToken(t: string) {
    token.value = t;
    localStorage.setItem(TOKEN_KEY, t);
  }

  function clearToken() {
    token.value = null;
    user.value = null;
    localStorage.removeItem(TOKEN_KEY);
  }

  async function loadUser(): Promise<boolean> {
    if (!token.value) return false;
    loading.value = true;
    try {
      user.value = await fetchMe(token.value);
      return true;
    } catch {
      clearToken();
      return false;
    } finally {
      loading.value = false;
    }
  }

  function loginWithFeishu() {
    window.location.href = `${import.meta.env.VITE_API_BASE ?? ""}/auth/feishu`;
  }

  function handleCallback(): string | null {
    const hash = window.location.hash;
    const match = hash.match(/token=([^&]+)/);
    if (match) {
      setToken(match[1]);
      return match[1];
    }
    return null;
  }

  function logout() {
    clearToken();
  }

  return {
    user,
    token,
    loading,
    isAuthenticated,
    setToken,
    clearToken,
    loadUser,
    loginWithFeishu,
    handleCallback,
    logout,
  };
});
