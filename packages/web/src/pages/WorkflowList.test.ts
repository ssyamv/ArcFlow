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
    vi.spyOn(api, "fetchWebhookJobs").mockResolvedValue({ data: [], total: 0 });

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

  it("renders webhook job diagnostics", async () => {
    vi.spyOn(api, "fetchExecutions").mockResolvedValue({ total: 0, data: [] });
    vi.spyOn(api, "fetchWebhookJobs")
      .mockResolvedValueOnce({
        total: 1,
        data: [
          {
            id: 11,
            source: "git",
            event_type: "pull_request",
            action: "code_merge",
            status: "pending",
            attempt_count: 1,
            max_attempts: 3,
            next_run_at: Date.now(),
            last_error: "code_gen_execution_not_found",
            payload: {},
            result: null,
            created_at: Date.now(),
            updated_at: Date.now(),
            correlation_id: "git:pr:ISS-120",
          },
        ],
      })
      .mockResolvedValueOnce({ total: 0, data: [] });

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/workflows", component: WorkflowList }],
    });
    const pinia = createPinia();

    await router.push("/workflows");
    await router.isReady();

    const wrapper = mount(WorkflowList, { global: { plugins: [router, pinia] } });
    await flushPromises();

    expect(wrapper.text()).toContain("Webhook job 排障");
    expect(wrapper.text()).toContain("code_gen_execution_not_found");
  });
});
