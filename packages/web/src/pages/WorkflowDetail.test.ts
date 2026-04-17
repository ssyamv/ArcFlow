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
        label: "backend 等待 callback",
        target: "backend",
        stage: "dispatch_running",
        status: "running",
      },
      subtasks: [
        {
          id: 3,
          target: "backend",
          stage: "dispatch",
          status: "failed",
          provider: "nanoclaw",
          repo_name: "acme/backend",
          branch_name: "feature/fix-timeout",
          log_url: "https://logs.example.com/backend/3",
          output_ref: "repos/backend/feature/fix-timeout",
          error_message: "command exited 1",
          execution_id: 12,
          input_ref: "issues/ISS-220",
          external_run_id: "run-123",
          started_at: "2026-04-16 12:01:00",
          finished_at: null,
          updated_at: "2026-04-16 12:03:00",
          created_at: "2026-04-16 12:01:00",
        },
      ],
      dispatches: [
        {
          id: "disp_123",
          workspace_id: "ws-123",
          skill: "arcflow-codegen",
          input_json: '{"execution_id":12,"target":"backend"}',
          status: "timeout",
          created_at: 1713326460000,
          completed_at: 1713326580000,
          plane_issue_id: "ISS-220",
          source_execution_id: 12,
          source_stage: "dispatch",
          started_at: 1713326470000,
          last_callback_at: 1713326570000,
          error_message: "callback timeout",
          result_summary: "late_callback_ignored",
          callback_replay_count: 2,
          timeout_at: 1713326560000,
          diagnostic_flags: ["timed_out", "late_callback_ignored"],
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
    expect(wrapper.text()).toContain("backend 等待 callback");
    expect(wrapper.text()).toContain("dispatch_running");
    expect(wrapper.text()).toContain("Dispatch / Callback 诊断");
    expect(wrapper.text()).toContain("disp_123");
    expect(wrapper.text()).toContain("arcflow-codegen");
    expect(wrapper.text()).toContain("late_callback_ignored");
    expect(wrapper.text()).toContain("timed_out");
    expect(wrapper.text()).toContain("目标轨迹与产物");
    expect(wrapper.text()).toContain("acme/backend");
    expect(wrapper.text()).toContain("feature/fix-timeout");
    expect(wrapper.text()).toContain("repos/backend/feature/fix-timeout");
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
