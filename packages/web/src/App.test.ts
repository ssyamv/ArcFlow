import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { createRouter, createWebHistory } from "vue-router";
import App from "./App.vue";

describe("App", () => {
  it("renders AppLayout", async () => {
    const router = createRouter({
      history: createWebHistory(),
      routes: [{ path: "/", component: { template: "<div>test</div>" } }],
    });

    const wrapper = mount(App, {
      global: {
        plugins: [createPinia(), router],
      },
    });

    await router.isReady();
    expect(wrapper.find(".app-layout").exists()).toBe(true);
  });
});
