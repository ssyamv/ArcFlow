import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "../api/workflow";
import WorkflowList from "./WorkflowList.vue";

describe("WorkflowList", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders code_gen summary in workflow list", async () => {
    vi.spyOn(api, "fetchExecutions").mockResolvedValue({
      total: 1,
      data: [
        {
          id: 7,
          workflow_type: "code_gen",
          trigger_source: "manual",
          plane_issue_id: "ISS-120",
          status: "running",
          error_message: null,
          started_at: "2026-04-16 12:00:00",
          completed_at: null,
          created_at: "2026-04-16 12:00:00",
          summary: { total_targets: 2, completed_targets: 1, latest_stage: "ci_running" },
        },
      ],
    });

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/workflows", component: WorkflowList }],
    });
    const pinia = createPinia();

    await router.push("/workflows");
    await router.isReady();

    const wrapper = mount(WorkflowList, { global: { plugins: [router, pinia] } });
    await flushPromises();

    expect(wrapper.text()).toContain("1/2");
    expect(wrapper.text()).toContain("ci_running");
  });
});
