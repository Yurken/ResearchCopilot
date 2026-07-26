import PptxGenJS from "pptxgenjs";
import { mapPptLayoutToBase, type PptData, type PptLayout, type PptSlide } from "./pptShared";

export function sanitizePptFileName(name: string) {
  const cleaned = name
    .trim()
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 40)
    .trim()
    .replace(/[. ]+$/g, "");
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(cleaned)) {
    return `${cleaned}-slides`;
  }
  return cleaned || "slides";
}

export function extractJsonObject(text: string) {
  const cleaned = text
    .replace(/```(?:json)?\s*/gi, "")
    .replace(/```/g, "")
    .trim();

  const start = cleaned.indexOf("{");
  if (start < 0) throw new Error("模型未返回有效 JSON 对象。");

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < cleaned.length; index += 1) {
    const char = cleaned[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return cleaned.slice(start, index + 1);
    }
  }

  throw new Error("模型返回的 JSON 不完整，请重试。");
}

export function normalizePptData(input: unknown): PptData {
  if (!input || typeof input !== "object") {
    throw new Error("模型返回格式错误：缺少演示数据对象。");
  }
  const raw = input as { title?: unknown; slides?: unknown };
  if (!Array.isArray(raw.slides) || raw.slides.length === 0) {
    throw new Error("模型返回格式错误：slides 不能为空。");
  }

  const validLayouts: PptLayout[] = [
    "title", "section", "content", "two_column", "highlight", "timeline",
    "agenda", "comparison", "process", "data_chart", "image_focus", "quote", "summary",
  ];
  const slides: PptSlide[] = raw.slides.slice(0, 40).map((slide, index) => {
    const source = (slide && typeof slide === "object" ? slide : {}) as Record<string, unknown>;
    const rawLayout = typeof source.layout === "string" && validLayouts.includes(source.layout as PptLayout)
      ? (source.layout as PptLayout)
      : "content";
    const layout = mapPptLayoutToBase(rawLayout);
    const title = typeof source.title === "string" && source.title.trim() ? source.title.trim() : `第 ${index + 1} 页`;

    const toLines = (value: unknown) =>
      Array.isArray(value)
        ? value
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim())
            .filter(Boolean)
            .slice(0, 5)
        : undefined;

    const bullets = toLines(source.bullets);
    const left = toLines(source.left);
    const right = toLines(source.right);
    const steps = (toLines(source.steps) ?? bullets)?.slice(0, 4);
    const highlight = typeof source.highlight === "string" ? source.highlight.trim() || undefined : undefined;
    const subtitle = typeof source.subtitle === "string" ? source.subtitle.trim() || undefined : undefined;
    const note = typeof source.note === "string" ? source.note.trim() || undefined : undefined;
    const quote = typeof source.quote === "string" ? source.quote.trim() || undefined : undefined;
    const imageSource = typeof source.image_source === "string"
      ? source.image_source.trim() || undefined
      : typeof source.imageSource === "string"
        ? source.imageSource.trim() || undefined
        : undefined;
    const chart = source.chart && typeof source.chart === "object"
      ? (source.chart as PptSlide["chart"])
      : undefined;

    return {
      layout,
      title,
      subtitle,
      bullets,
      left,
      right,
      highlight: highlight ?? subtitle ?? bullets?.[0],
      steps,
      note,
      quote,
      imageSource,
      chart,
    };
  });

  return {
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : "演示文稿",
    slides,
  };
}

export async function buildPptx(data: PptData): Promise<ArrayBuffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";

  const width = 13.33;
  const height = 7.5;
  const colors = {
    navy: "0D1B2A",
    blue: "007AFF",
    white: "FFFFFF",
    text: "1A2233",
    border: "D0D6DC",
    muted: "9AA3AD",
    light: "F4F6F9",
    softBlue: "EAF3FF",
    softGreen: "EAF8EF",
  };

  const total = data.slides.length;
  type DeckSlide = ReturnType<typeof pptx.addSlide>;

  const addHeader = (slide: DeckSlide, title: string) => {
    slide.background = { color: colors.light };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: width, h: 1.25, fill: { type: "solid", color: colors.navy } });
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 1.25, w: width, h: 0.06, fill: { type: "solid", color: colors.blue } });
    slide.addText(title, { x: 0.5, y: 0.18, w: width - 1, h: 0.9, fontSize: 26, bold: true, color: colors.white, valign: "middle" });
  };

  // 正文页页脚：左下角演示标题、右下角页码，提升成稿感与可导航性。
  const addFooter = (slide: DeckSlide, pageNumber: number) => {
    slide.addText(data.title, { x: 0.5, y: height - 0.45, w: width - 2, h: 0.3, fontSize: 9, color: colors.muted, align: "left", valign: "middle" });
    slide.addText(`${pageNumber} / ${total}`, { x: width - 1.4, y: height - 0.45, w: 0.9, h: 0.3, fontSize: 9, color: colors.muted, align: "right", valign: "middle" });
  };

  const asBulletRuns = (items: string[], paraSpaceAfter: number) =>
    items.map((bullet) => ({ text: bullet, options: { bullet: { code: "2022" }, paraSpaceAfter } }));

  let pageNumber = 0;
  for (const slide of data.slides) {
    pageNumber += 1;
    const pptSlide = pptx.addSlide();

    if (slide.layout === "title") {
      pptSlide.background = { color: colors.navy };
      pptSlide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: width, h: height, fill: { type: "solid", color: colors.blue, transparency: 72 } });
      pptSlide.addShape(pptx.ShapeType.rect, { x: 0, y: height - 0.18, w: width, h: 0.18, fill: { type: "solid", color: colors.blue, transparency: 0 } });
      pptSlide.addText(slide.title, { x: 1.2, y: 2.3, w: width - 2.4, h: 1.6, fontSize: 42, bold: true, color: colors.white, align: "center", valign: "middle" });
      if (slide.subtitle) pptSlide.addText(slide.subtitle, { x: 1.2, y: 4.1, w: width - 2.4, h: 0.9, fontSize: 20, color: "AACCFF", align: "center" });
    } else if (slide.layout === "section") {
      pptSlide.background = { color: colors.blue };
      pptSlide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.12, h: height, fill: { type: "solid", color: colors.white, transparency: 40 } });
      pptSlide.addText(slide.title, { x: 0.8, y: 2.6, w: width - 1.6, h: 1.4, fontSize: 36, bold: true, color: colors.white, align: "center", valign: "middle" });
      if (slide.subtitle) pptSlide.addText(slide.subtitle, { x: 0.8, y: 4.2, w: width - 1.6, h: 0.8, fontSize: 18, color: "DDEEFF", align: "center" });
    } else if (slide.layout === "content") {
      addHeader(pptSlide, slide.title);
      if (slide.bullets?.length) {
        pptSlide.addText(
          asBulletRuns(slide.bullets, 10),
          { x: 0.7, y: 1.55, w: width - 1.4, h: height - 2, fontSize: 19, color: colors.text, valign: "top", lineSpacingMultiple: 1.3 }
        );
      }
    } else if (slide.layout === "two_column") {
      addHeader(pptSlide, slide.title);
      pptSlide.addShape(pptx.ShapeType.line, { x: width / 2, y: 1.5, w: 0, h: height - 1.9, line: { color: colors.border, width: 1 } });
      const columnOptions = { fontSize: 18, color: colors.text, valign: "top" as const, lineSpacingMultiple: 1.3 };
      if (slide.left?.length) pptSlide.addText(asBulletRuns(slide.left, 8), { x: 0.5, y: 1.55, w: width / 2 - 0.8, h: height - 2, ...columnOptions });
      if (slide.right?.length) pptSlide.addText(asBulletRuns(slide.right, 8), { x: width / 2 + 0.3, y: 1.55, w: width / 2 - 0.8, h: height - 2, ...columnOptions });
    } else if (slide.layout === "highlight") {
      addHeader(pptSlide, slide.title);
      pptSlide.addShape(pptx.ShapeType.rect, {
        x: 0.75,
        y: 1.75,
        w: width - 1.5,
        h: 2.3,
        fill: { type: "solid", color: colors.softBlue },
        line: { color: colors.blue, transparency: 75 },
      });
      pptSlide.addText(slide.highlight ?? slide.subtitle ?? "核心结论", {
        x: 1.1,
        y: 2.2,
        w: width - 2.2,
        h: 1.25,
        fontSize: 28,
        bold: true,
        color: colors.navy,
        align: "center",
        valign: "middle",
      });
      if (slide.bullets?.length) {
        pptSlide.addText(asBulletRuns(slide.bullets.slice(0, 3), 10), {
          x: 1,
          y: 4.45,
          w: width - 2,
          h: 1.8,
          fontSize: 17,
          color: colors.text,
          lineSpacingMultiple: 1.2,
        });
      }
    } else if (slide.layout === "timeline") {
      addHeader(pptSlide, slide.title);
      const steps = slide.steps?.slice(0, 4) ?? [];
      if (steps.length < 2) {
        if (slide.bullets?.length) {
          pptSlide.addText(asBulletRuns(slide.bullets, 10), {
            x: 0.8,
            y: 1.7,
            w: width - 1.6,
            h: height - 2.1,
            fontSize: 18,
            color: colors.text,
            lineSpacingMultiple: 1.25,
          });
        }
      } else {
        const startX = 1.25;
        const endX = width - 1.25;
        const lineY = 2.75;
        const gap = (endX - startX) / (steps.length - 1);

        pptSlide.addShape(pptx.ShapeType.line, {
          x: startX,
          y: lineY,
          w: endX - startX,
          h: 0,
          line: { color: colors.border, width: 1.4 },
        });

        steps.forEach((step, index) => {
          const centerX = startX + gap * index;
          pptSlide.addShape(pptx.ShapeType.ellipse, {
            x: centerX - 0.22,
            y: lineY - 0.22,
            w: 0.44,
            h: 0.44,
            fill: { type: "solid", color: colors.blue },
            line: { color: colors.white, transparency: 100 },
          });
          pptSlide.addText(String(index + 1), {
            x: centerX - 0.18,
            y: lineY - 0.16,
            w: 0.36,
            h: 0.26,
            fontSize: 11,
            bold: true,
            color: colors.white,
            align: "center",
          });
          pptSlide.addShape(pptx.ShapeType.rect, {
            x: centerX - 1.15,
            y: lineY + 0.4,
            w: 2.3,
            h: 1.45,
            fill: { type: "solid", color: index % 2 === 0 ? colors.softBlue : colors.softGreen },
            line: { color: colors.border, transparency: 65 },
          });
          pptSlide.addText(step, {
            x: centerX - 0.95,
            y: lineY + 0.72,
            w: 1.9,
            h: 0.9,
            fontSize: 15,
            bold: true,
            color: colors.text,
            align: "center",
            valign: "middle",
          });
        });
      }
    }

    // 正文页加页脚/页码；标题页与章节页保持整洁不加。
    if (
      slide.layout === "content" ||
      slide.layout === "two_column" ||
      slide.layout === "highlight" ||
      slide.layout === "timeline"
    ) {
      addFooter(pptSlide, pageNumber);
    }

    // 演讲者备注：借鉴 PPTX 制作规范，每页附演讲脚本，写入 PowerPoint 备注栏（不显示在幻灯片上）。
    if (slide.note) {
      pptSlide.addNotes(slide.note);
    }
  }

  return (await pptx.write({ outputType: "arraybuffer" })) as ArrayBuffer;
}
