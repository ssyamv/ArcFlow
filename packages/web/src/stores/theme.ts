import { defineStore } from "pinia";
import { ref, watch } from "vue";

type Theme = "dark" | "light";
const STORAGE_KEY = "arcflow_theme";

export const useThemeStore = defineStore("theme", () => {
  const theme = ref<Theme>((localStorage.getItem(STORAGE_KEY) as Theme) ?? "dark");

  function apply(t: Theme) {
    document.documentElement.setAttribute("data-theme", t);
  }

  function toggle() {
    theme.value = theme.value === "dark" ? "light" : "dark";
  }

  watch(
    theme,
    (t) => {
      localStorage.setItem(STORAGE_KEY, t);
      apply(t);
    },
    { immediate: true },
  );

  return { theme, toggle };
});
