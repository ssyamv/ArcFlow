function createMemoryStorage(): Storage {
  const store = new Map<string, string>();

  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

function installStorage(name: "localStorage" | "sessionStorage") {
  const candidate = window[name];
  const storage =
    candidate && typeof candidate.getItem === "function"
      ? candidate
      : createMemoryStorage();

  Object.defineProperty(window, name, {
    configurable: true,
    writable: true,
    value: storage,
  });

  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value: storage,
  });
}

installStorage("localStorage");
installStorage("sessionStorage");
