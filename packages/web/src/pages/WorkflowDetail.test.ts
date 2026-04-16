import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "../api/workflow";
import WorkflowDetail from "./WorkflowDetail.vue";

describe("WorkflowDetail", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders subtasks and workflow links in detail view", async () => {
    vi.spyOn(api, "fetchExecution").mockResolvedValue({
      id: 7,
      workflow_type: "code_gen",
      trigger_source: "manual",
      plane_issue_id: "ISS-120",
      input_path: "api/feature.yaml",
      status: "failed",
      error_message: null,
      started_at: "2026-04-16 12:00:00",
      completed_at: "2026-04-16 12:10:00",
      created_at: "2026-04-16 12:00:00",
      subtasks: [
        { id: 1, target: "backend", stage: "ci_failed", status: "failed", provider: "ibuild" },
      ],
      links: [
        {
          id: 1,
          source_execution_id: 7,
          target_execution_id: 8,
          link_type: "spawned_on_ci_failure",
        },
      ],
    });

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/workflows", component: { template: "<div>list</div>" } },
        { path: "/workflows/:id", component: WorkflowDetail },
      ],
    });

    await router.push("/workflows/7");
    await router.isReady();

    const wrapper = mount(WorkflowDetail, { global: { plugins: [router] } });
    await flushPromises();

    expect(wrapper.text()).toContain("backend");
    expect(wrapper.text()).toContain("ci_failed");
    expect(wrapper.text()).toContain("spawned_on_ci_failure");
  });
});
