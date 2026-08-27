import { beforeEach, describe, expect, it } from "vitest";
import {
  isLegacyMigrationPending,
  markLegacyMigrationDone,
  migrateLegacyDrafts,
  readLegacyDraftsForMigration,
  WRITING_LIBRARY_MIGRATED_KEY,
} from "../../../features/writing/legacyDraftLibrary";
import {
  WRITING_LIBRARY_STORAGE_KEY,
  WRITING_STORAGE_KEY,
} from "../../../features/writing/shared";

function legacyDraft(id: string, projectName: string) {
  return {
    id,
    projectName,
    templateId: "journal",
    mainTex: `\\section{${projectName}}`,
    bibtex: "",
    texFiles: [],
    notes: "",
    imageAssets: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  };
}

describe("legacyDraftLibrary 迁移", () => {
  beforeEach(() => localStorage.clear());

  it("汇总两个旧 key 的草稿并按 id 去重，保留原 id 与时间戳", () => {
    localStorage.setItem(
      WRITING_LIBRARY_STORAGE_KEY,
      JSON.stringify({ drafts: [legacyDraft("d1", "论文一"), legacyDraft("d2", "论文二")] }),
    );
    localStorage.setItem(
      WRITING_STORAGE_KEY,
      JSON.stringify({ projectName: "旧草稿", templateId: "journal", mainTex: "tex", bibtex: "", notes: "n" }),
    );

    const drafts = readLegacyDraftsForMigration();
    expect(drafts).toHaveLength(3);
    const first = drafts[0];
    expect(first.id).toBe("d1");
    expect(first.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(first.updatedAt).toBe("2026-01-02T00:00:00.000Z");
    expect(drafts[2].projectName).toBe("旧草稿");
  });

  it("逐条导入：同 id 跳过、失败不阻塞其他条，汇总不含正文", async () => {
    const drafts = [
      legacyDraft("d1", "已存在"),
      legacyDraft("d2", "会失败"),
      legacyDraft("d3", "正常"),
    ] as never[];
    const summary = await migrateLegacyDrafts({
      drafts,
      existingIds: new Set(["d1"]),
      importDraft: async (draft) => {
        if (draft.id === "d2") throw new Error("磁盘写入失败");
      },
    });

    expect(summary).toMatchObject({ attempted: 3, imported: 1, skipped: 1, failed: 1 });
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0]).toContain("会失败");
    expect(summary.errors[0]).not.toContain("\\section{会失败}");
  });

  it("迁移标记写入后不再判定为待迁移，旧 key 数据保留", () => {
    localStorage.setItem(WRITING_LIBRARY_STORAGE_KEY, JSON.stringify({ drafts: [legacyDraft("d1", "论文一")] }));
    expect(isLegacyMigrationPending()).toBe(true);

    markLegacyMigrationDone({ attempted: 1, imported: 1, skipped: 0, failed: 0, errors: [] });
    expect(isLegacyMigrationPending()).toBe(false);
    expect(localStorage.getItem(WRITING_LIBRARY_MIGRATED_KEY)).toBeTruthy();
    // 旧数据不删除。
    expect(localStorage.getItem(WRITING_LIBRARY_STORAGE_KEY)).toBeTruthy();
  });

  it("无旧 key 或已有标记时不重复导入", () => {
    expect(isLegacyMigrationPending()).toBe(false);
    localStorage.setItem(WRITING_LIBRARY_MIGRATED_KEY, "{}");
    localStorage.setItem(WRITING_LIBRARY_STORAGE_KEY, JSON.stringify({ drafts: [legacyDraft("d1", "论文一")] }));
    expect(isLegacyMigrationPending()).toBe(false);
  });
});
