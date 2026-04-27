import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "../api/workflow";
import WebhookJobs from "./WebhookJobs.vue";

describe("WebhookJobs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders filtered jobs and loads payload/result detail", async () => {
    vi.spyOn(api, "fetchWebhookJobs").mockResolvedValue({
      total: 1,
      data: [
        {
          id: 11,
          source: "git",
          event_type: "pull_request",
          action: "code_merge",
          status: "dead",
          attempt_count: 3,
          max_attempts: 3,
          next_run_at: null,
          last_error: "code_gen_execution_not_found",
          payload: { branch: "feature/ISS-120-backend" },
          result: { matched: false },
          created_at: 1713326460000,
          updated_at: 1713326580000,
          correlation_id: "git:pr:ISS-120",
        },
      ],
    });
    vi.spyOn(api, "fetchWebhookJob").mockResolvedValue({
      id: 11,
      source: "git",
      event_type: "pull_request",
      action: "code_merge",
      status: "dead",
      attempt_count: 3,
      max_attempts: 3,
      next_run_at: null,
      last_error: "code_gen_execution_not_found",
      payload: { branch: "feature/ISS-120-backend", repository: "backend" },
      result: { matched: false },
      created_at: 1713326460000,
      updated_at: 1713326580000,
      correlation_id: "git:pr:ISS-120",
    });

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/webhook-jobs", component: WebhookJobs }],
    });
    await router.push("/webhook-jobs?source=git&status=dead&action=code_merge&job=11");
    await router.isReady();

    const wrapper = mount(WebhookJobs, { global: { plugins: [router] } });
    await flushPromises();

    expect(api.fetchWebhookJobs).toHaveBeenCalledWith({
      source: "git",
      status: "dead",
      action: "code_merge",
      limit: 50,
    });
    expect(api.fetchWebhookJob).toHaveBeenCalledWith(11);
    expect(wrapper.text()).toContain("Webhook Jobs");
    expect(wrapper.text()).toContain("#11");
    expect(wrapper.text()).toContain("dead");
    expect(wrapper.text()).toContain("Dead 原因");
    expect(wrapper.text()).toContain("git:pr:ISS-120");
    expect(wrapper.text()).toContain("code_gen_execution_not_found");
    expect(wrapper.text()).toContain("feature/ISS-120-backend");
    expect(wrapper.text()).toContain('"matched": false');
  });

  it("selects a job from the table and updates detail query", async () => {
    vi.spyOn(api, "fetchWebhookJobs").mockResolvedValue({
      total: 1,
      data: [
        {
          id: 12,
          source: "git",
          event_type: "pull_request",
          action: "code_merge",
          status: "pending",
          attempt_count: 1,
          max_attempts: 3,
          next_run_at: 1713326760000,
          last_error: "code_gen_execution_not_found",
          payload: {},
          result: null,
          created_at: 1713326460000,
          updated_at: 1713326580000,
          correlation_id: "git:pr:ISS-121",
        },
      ],
    });
    vi.spyOn(api, "fetchWebhookJob").mockResolvedValue({
      id: 12,
      source: "git",
      event_type: "pull_request",
      action: "code_merge",
      status: "pending",
      attempt_count: 1,
      max_attempts: 3,
      next_run_at: 1713326760000,
      last_error: "code_gen_execution_not_found",
      payload: { branch: "feature/ISS-121-web" },
      result: null,
      created_at: 1713326460000,
      updated_at: 1713326580000,
      correlation_id: "git:pr:ISS-121",
    });

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/webhook-jobs", component: WebhookJobs }],
    });
    await router.push("/webhook-jobs");
    await router.isReady();

    const wrapper = mount(WebhookJobs, { global: { plugins: [router] } });
    await flushPromises();

    await wrapper.find("tbody tr").trigger("click");
    await flushPromises();

    expect(router.currentRoute.value.query.job).toBe("12");
    expect(wrapper.text()).toContain("feature/ISS-121-web");
    expect(wrapper.text()).toContain("2024-04-17 04:06:00");
  });
});
