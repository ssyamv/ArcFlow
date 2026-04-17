import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import AiArtifactCard from "./AiArtifactCard.vue";

describe("AiArtifactCard", () => {
  it("renders links for card artifacts", () => {
    const wrapper = mount(AiArtifactCard, {
      props: {
        artifact: {
          id: "1",
          type: "arcflow_card",
          title: "需求草稿预览",
          content: JSON.stringify({
            fields: [{ label: "路径", value: "requirements/2026-04/demo.md" }],
            actions: [{ label: "查看文档", url: "/docs?path=requirements/2026-04/demo.md" }],
          }),
        },
      },
    });
    expect(wrapper.text()).toContain("需求草稿预览");
    expect(wrapper.text()).toContain("查看文档");
  });

  it("renders stage, progress, and detail for status artifacts", () => {
    const wrapper = mount(AiArtifactCard, {
      props: {
        artifact: {
          id: "2",
          type: "arcflow_status",
          title: "暂无待处理 Issue",
          content: JSON.stringify({
            stage: "empty",
            progress: 100,
            detail: "当前工作空间没有分配给你的 Issue",
          }),
        },
      },
    });

    expect(wrapper.text()).toContain("暂无待处理 Issue");
    expect(wrapper.text()).toContain("empty");
    expect(wrapper.text()).toContain("100%");
    expect(wrapper.text()).toContain("当前工作空间没有分配给你的 Issue");
  });
});
