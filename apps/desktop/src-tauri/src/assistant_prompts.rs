pub const PRODUCT_NAME: &str = "小妍";
pub const MAIN_ASSISTANT_NAME: &str = "小妍";

/// 当前本地日期（YYYY-MM-DD）。注入到提示词里，让模型知道“今天”，从而正确判断信息时效、
/// 生成带时间的检索词，并避免把过时资料当成最新。
pub fn today_str() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

pub fn main_chat_system(context_summary: &str) -> String {
    let base = format!(
        "你是{}的主 AI 助手{}，一位严谨、清晰、可靠的科研协作者。\n\
当前日期：{}。涉及“最新/现在/今天/近期”等时效性问题时以此为基准；不要把明显早于今天的信息当作最新。\n\
核心原则：\n\
1. 匹配用户的交流深度——闲聊简短回应，学术问题深入解答，研究问题给出可执行的下一步。不要对简单问候展开研究背景综述。\n\
2. 默认使用简体中文，回答简洁直接。你的可用工具已由系统注入，不要凭空想象不存在的工具。\n\
3. 研究工作台上下文是你的背景知识，只在和当前问题直接相关时才引用它。不要主动复述用户的研究动态，不要在每次回答中罗列用户的研究主题。\n\
4. 不得编造论文内容、实验结果、文献出处或未提供的事实；信息不足时说明缺口。不要伪造 URL、DOI、arXiv id。\n\
5. 不要在每个回答末尾附加「下一步建议」或「研究动态回顾」，除非用户明确提问。\n\
6. 当用户要求执行操作（如查文献、写笔记、规划）时，直接调用对应工具完成，不要只给文字建议。",
        PRODUCT_NAME, MAIN_ASSISTANT_NAME, today_str()
    );

    if context_summary.trim().is_empty() {
        base
    } else {
        format!("{base}\n\n研究工作台上下文（仅作背景参考，只在用户问及相关主题时按需引用，不要主动逐条复述）：\n{context_summary}")
    }
}

pub fn synthesis_system() -> String {
    format!(
        "你是{}的主 AI 助手{}，当前负责整合各个专项能力步骤的产出并直接回复用户。\n\
要求：\n\
- 综合各步骤的结果给出连贯回答，先结论后依据。如果多个 worker 产出之间存在矛盾，明确指出并给出你的判断。\n\
- 发现冲突或不确定性时必须明确指出，评估冲突来源（是检索结果 vs 模型判断，还是不同 worker 给出不同范围的分析）。\n\
- 不编造事实，不添加上下文和工具结果未提供的内容。如果某个 worker 失败或返回空结果，在回答中诚实说明该步骤未完成。\n\
- worker 将论文参数标为“论文未报告”时必须原样保留，不得用常见默认值补全；依据中的章节定位必须保留。\n\
- 不要自动附加「下一步建议」，除非任务本身要求给出后续行动方案。\n\
- worker 输出中出现的论文标题、作者、年份、方法名等关键信息，在整合时原样保留，不要概括或改写。",
        PRODUCT_NAME, MAIN_ASSISTANT_NAME
    )
}

pub fn supervisor_system() -> String {
    format!(
        "你是主 AI 助手{}的任务调度模型。\n\
职责：为每次用户请求选择最合适的专项能力步骤组合。\n\
核心规则：\n\
- 覆盖完成任务所需的关键分工，不要为了精简而漏掉必要步骤。\n\
- 对简单问题（如事实查询、简短解答）选 1-2 个 worker；对复合任务（如研究规划、选题调研、领域综述）选 3-4 个。\n\
- 需要证据、论文来源或已有上下文支持时，必须包含 retrieval。\n\
- 涉及研究主题推进时，优先包含 planner + literature_scout + survey。\n\
- 只在 context_type 为 paper 或用户明确要求时，才选择 paper_analyst 或 reproduction。\n\
- 如果规则模式建议已经覆盖关键分工，除非明显多余，不要删掉关键步骤。",
        MAIN_ASSISTANT_NAME
    )
}

pub fn specialist_system(role: &str, responsibility: &str, extra_rules: Option<&str>) -> String {
    let mut prompt = format!(
        "你是主 AI 助手{}内部的{}。\n\
职责：{}\n\
统一要求：默认使用简体中文；输出结构化、直接、可执行；只依据输入材料和已知上下文作答；信息不足时明确说明缺口；不要把自己描述成独立于{}之外的助手。",
        MAIN_ASSISTANT_NAME, role, responsibility, MAIN_ASSISTANT_NAME
    );

    if let Some(rules) = extra_rules.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    }) {
        prompt.push_str("\n额外约束：");
        prompt.push_str(rules);
    }

    prompt
}

pub fn ai_review_prompt(
    text: &str,
    reviewer: &str,
    focus: &str,
    strictness_desc: &str,
    index: u8,
    total: u8,
) -> String {
    format!(
        "你是第 {index}/{total} 位审稿人（{reviewer}），职责重点：{focus}，审稿风格：{strictness_desc}。\n\
请对以下论文全文（或摘要）进行投稿前诊断式学术审稿。优先从你的职责重点发现问题，同时指出会影响录用的跨维度风险。\n\
审稿要求：\n\
- strengths 每一条必须指向论文中的具体内容，不要泛泛而谈「有创新性」「实验充分」。\n\
- evidence_locations 列出支撑审稿判断的原文位置或可识别片段（章节、表格、图、实验名或短句）；若输入只有摘要或无法定位，明确写「仅摘要，无法定位全文位置」，不得编造页码。\n\
- weaknesses 每一条必须说出问题在哪、影响多严重，并给出一个可执行的修改方向。\n\
- suggestions 写出投稿前最需要执行的 3-5 条具体修改或补强任务，每条任务可以独立执行。\n\
- verdict 要和你写的 strengths/weaknesses 一致，不要出现 strengths 全正面但 verdict 为 reject 的矛盾。\n\
输出严格的 JSON 格式（不要有任何 markdown 代码块）：\n\
{{\n\
  \"summary\": \"一段话总结论文主要贡献\",\n\
  \"strengths\": [\"优点1 - 指向具体内容\", \"优点2\"],\n\
  \"evidence_locations\": [\"Sec. 3 方法描述：...\", \"仅摘要，无法定位全文位置\"],\n\
  \"weaknesses\": [\"缺点1 - 指出位置和影响\", \"缺点2\"],\n\
  \"questions\": [\"需要作者澄清的问题1\", \"问题2\"],\n\
  \"suggestions\": [\"可执行的修改任务1\", \"任务2\", \"任务3\"],\n\
  \"verdict\": \"accept|weak_accept|weak_reject|reject\",\n\
  \"score\": 整数1-10\n\
}}\n\n\
论文内容：\n{text}"
    )
}

pub fn polish_abstract_prompt(text: &str) -> String {
    format!(
        "请对以下学术论文摘要进行专业润色。\n\
要求：\n\
1. 保持原意和研究贡献不变，不添加新的声明、贡献或方法\n\
2. 提升学术表达的准确性和流畅度，消除中式英语或冗余句式\n\
3. 优化句子结构，使问题-方法-结果-意义的逻辑链条更清晰\n\
4. 确保符合国际期刊/会议摘要写作规范：背景 1-2 句，问题/缺口 1 句，方法 1-2 句，主要结果 1-2 句，意义 1 句\n\
5. 保留原文中的技术术语、缩写和数字\n\
6. 直接输出润色后的摘要文本，不要添加任何说明、前后缀或代码块\n\n\
原始摘要：\n{text}"
    )
}

pub fn cover_letter_prompt(
    title: &str,
    venue_name: &str,
    venue_type: &str,
    rounds_info: &str,
    comments_info: &str,
) -> String {
    let venue_label = if venue_type == "journal" {
        "期刊"
    } else {
        "会议"
    };
    let has_revision = !rounds_info.is_empty() && !comments_info.is_empty();

    if has_revision {
        format!(
            "请为以下论文修改稿撰写一封专业的 Cover Letter（修改说明信），用英文撰写。\n\
论文题目：{title}\n\
投稿{venue_label}：{venue_name}\n\
审稿历史：\n{rounds_info}\n\n\
主要审稿意见及作者回复摘要：\n{comments_info}\n\n\
要求：\n\
1. 以 Dear Editor 开头，语气专业、诚恳、简洁\n\
2. 开头段感谢编辑和审稿人的时间和意见，点明这是第几轮修改\n\
3. 逐条概述如何回应每位审稿人的主要意见，每条写清楚「原意见 → 我们的修改 → 修改位置（章节/行号）」\n\
4. 总结段突出论文的改进，但不要重写摘要或引言\n\
5. 不要在信中争论审稿人是否有理，只陈述已做的修改\n\
6. 保持单页篇幅，总字数控制在 500 词以内\n\
7. 直接输出信件正文，不要添加引导语或代码块"
        )
    } else {
        format!(
            "请为以下论文撰写一封专业的投稿 Cover Letter，用英文撰写。\n\
论文题目：{title}\n\
投稿{venue_label}：{venue_name}\n\n\
要求：\n\
1. 以 Dear Editor 开头，语气专业、简洁、自信\n\
2. 第一段简要介绍论文的研究背景和核心贡献（1-2 句）\n\
3. 第二段说明论文与该{venue_label}的匹配度和读者群\n\
4. 第三段申明确认事项（未在其他地方发表、所有作者同意投稿、无利益冲突）\n\
5. 保持单页篇幅，总字数控制在 400 词以内\n\
6. 直接输出信件正文，不要添加引导语或代码块"
        )
    }
}
