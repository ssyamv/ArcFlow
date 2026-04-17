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

  it("renders current stage diagnostics, dispatch details, and richer target artifacts", async () => {
    vi.spyOn(api, "fetchExecution").mockResolvedValue({
      id: 12,
      workflow_type: "code_gen",
      trigger_source: "manual",
      plane_issue_id: "ISS-220",
      input_path: "specs/api.yaml",
      status: "failed",
      error_message: "callback timeout",
      started_at: "2026-04-16 12:00:00",
      completed_at: "2026-04-16 12:15:00",
      created_at: "2026-04-16 11:58:00",
      current_stage_summary: {
        stage: "dispatching",
        status: "running",
        dispatch_count: 1,
        last_dispatch_status: "callback_pending",
        callback_status: "waiting",
      },
      subtasks: [
        {
          id: 3,
          target: "backend",
          stage: "dispatching",
          status: "failed",
          provider: "ibuild",
          repo_name: "acme/backend",
          branch_name: "feature/fix-timeout",
          log_url: "https://logs.example.com/backend/3",
          error_message: "command exited 1",
        },
      ],
      dispatches: [
        {
          id: 31,
          dispatch_id: "disp_123",
          stage: "dispatching",
          status: "callback_pending",
          target: "backend",
          provider: "ibuild",
          repo_name: "acme/backend",
          branch_name: "feature/fix-timeout",
          log_url: "https://logs.example.com/backend/3",
          output_path: "runs/12/backend/result.json",
          callback_status: "waiting",
          created_at: "2026-04-16 12:01:00",
          updated_at: "2026-04-16 12:02:00",
        },
      ],
      links: [
        {
          id: 5,
          source_execution_id: 12,
          target_execution_id: 13,
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

    await router.push("/workflows/12");
    await router.isReady();

    const wrapper = mount(WorkflowDetail, { global: { plugins: [router] } });
    await flushPromises();

    expect(wrapper.text()).toContain("当前阶段摘要");
    expect(wrapper.text()).toContain("dispatching");
    expect(wrapper.text()).toContain("callback_pending");
    expect(wrapper.text()).toContain("Dispatch / Callback 诊断");
    expect(wrapper.text()).toContain("disp_123");
    expect(wrapper.text()).toContain("waiting");
    expect(wrapper.text()).toContain("runs/12/backend/result.json");
    expect(wrapper.text()).toContain("目标轨迹与产物");
    expect(wrapper.text()).toContain("acme/backend");
    expect(wrapper.text()).toContain("feature/fix-timeout");
    expect(wrapper.find('a[href="https://logs.example.com/backend/3"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("spawned_on_ci_failure");
  });

  it("renders the tech_to_openapi to code_gen to bug_analysis chain", async () => {
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
          source_execution_id: 6,
          target_execution_id: 7,
          link_type: "derived_from",
        },
        {
          id: 2,
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

    expect(wrapper.text()).toContain("derived_from");
    expect(wrapper.text()).toContain("backend");
    expect(wrapper.text()).toContain("ci_failed");
    expect(wrapper.text()).toContain("spawned_on_ci_failure");
  });

  it("refetches when navigating to a related workflow", async () => {
    vi.spyOn(api, "fetchExecution").mockImplementation(async (id) => {
      if (id === 7) {
        return {
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
        };
      }

      return {
        id: 8,
        workflow_type: "bug_analysis",
        trigger_source: "system",
        plane_issue_id: "ISS-120",
        input_path: null,
        status: "success",
        error_message: null,
        started_at: "2026-04-16 12:11:00",
        completed_at: "2026-04-16 12:20:00",
        created_at: "2026-04-16 12:11:00",
        subtasks: [
          {
            id: 2,
            target: "frontend",
            stage: "analysis_done",
            status: "success",
            provider: "ibuild",
          },
        ],
        links: [],
      };
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

    const targetLink = wrapper.findAll("a").find((node) => node.text().includes("#8"));
    expect(targetLink).toBeDefined();

    await targetLink!.trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("执行详情 #8");
    expect(wrapper.text()).toContain("frontend");
    expect(wrapper.text()).toContain("analysis_done");
    expect(wrapper.text()).not.toContain("backend");
  });
});
