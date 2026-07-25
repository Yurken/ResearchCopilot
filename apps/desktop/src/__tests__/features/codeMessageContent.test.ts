import { describe, expect, it } from "vitest";
import { buildCodePromptContent } from "../../features/code/codeMessageContent";

describe("buildCodePromptContent", () => {
  it("把技能和附件放入模型提示但保留独立可见文本", () => {
    const displayContent = "帮我检查训练脚本";
    const promptContent = buildCodePromptContent({
      displayContent,
      skillPrompt: "内部技能指令",
      attachments: [{
        id: "attachment-1",
        name: "train.py",
        path: "/project/train.py",
        content: "print('train')",
        truncated: false,
      }],
    });

    expect(displayContent).toBe("帮我检查训练脚本");
    expect(promptContent).toContain("内部技能指令");
    expect(promptContent).toContain("<file-context>");
    expect(promptContent).toContain("print('train')");
  });

  it("没有额外上下文时直接返回用户输入", () => {
    expect(buildCodePromptContent({ displayContent: "运行测试" })).toBe("运行测试");
  });
});
