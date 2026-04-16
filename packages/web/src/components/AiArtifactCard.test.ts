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
});
