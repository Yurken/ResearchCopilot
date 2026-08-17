use serde::Serialize;
use std::collections::HashSet;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentTool {
    ResearchContext,
    PaperLibrarySearch,
    PaperFullText,
    GraphRagSearch,
    MemoryRecall,
    SubmissionDiagnosis,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentToolDescriptor {
    pub name: &'static str,
    pub title: &'static str,
    pub description: &'static str,
}

impl AgentTool {
    pub fn descriptor(self) -> AgentToolDescriptor {
        match self {
            Self::ResearchContext => AgentToolDescriptor {
                name: "research_context",
                title: "研究主题上下文",
                description: "读取当前研究主题、路线阶段、关联论文与笔记摘要。",
            },
            Self::PaperLibrarySearch => AgentToolDescriptor {
                name: "paper_library_search",
                title: "论文库检索",
                description: "在本地论文库和语义索引中检索与问题相关的证据。",
            },
            Self::PaperFullText => AgentToolDescriptor {
                name: "paper_full_text",
                title: "论文全文读取",
                description: "读取当前论文全文片段，用于精读、方法分析和复现判断。",
            },
            Self::GraphRagSearch => AgentToolDescriptor {
                name: "graph_rag_search",
                title: "Graph RAG 证据链",
                description: "从知识图谱和引用关系中补充可追溯的证据链。",
            },
            Self::MemoryRecall => AgentToolDescriptor {
                name: "memory_recall",
                title: "长期记忆召回",
                description: "召回用户近期决策、偏好和研究推进记录，并遵守隐私边界。",
            },
            Self::SubmissionDiagnosis => AgentToolDescriptor {
                name: "submission_diagnosis",
                title: "投稿诊断",
                description: "围绕论文版本、目标刊会和审稿风险生成投稿前诊断。",
            },
        }
    }
}

pub fn tools_for_agent(agent_name: &str) -> &'static [AgentTool] {
    match agent_name {
        "retrieval" => &[
            AgentTool::PaperLibrarySearch,
            AgentTool::GraphRagSearch,
            AgentTool::MemoryRecall,
        ],
        "planner" => &[AgentTool::ResearchContext, AgentTool::MemoryRecall],
        "literature_scout" | "survey" => &[
            AgentTool::ResearchContext,
            AgentTool::PaperLibrarySearch,
            AgentTool::GraphRagSearch,
        ],
        "paper_analyst" | "reproduction" => &[AgentTool::PaperFullText, AgentTool::GraphRagSearch],
        "synthesis" => &[
            AgentTool::ResearchContext,
            AgentTool::MemoryRecall,
            AgentTool::SubmissionDiagnosis,
        ],
        _ => &[],
    }
}

pub fn collect_tool_descriptors(
    selected_agents: &[String],
    context_type: &str,
) -> Vec<AgentToolDescriptor> {
    let mut tools = HashSet::new();

    for agent_name in selected_agents {
        for tool in tools_for_agent(agent_name) {
            tools.insert(*tool);
        }
    }

    match context_type {
        "interest" => {
            tools.insert(AgentTool::ResearchContext);
        }
        "paper" => {
            tools.insert(AgentTool::PaperFullText);
        }
        _ => {}
    }

    let order = [
        AgentTool::ResearchContext,
        AgentTool::PaperLibrarySearch,
        AgentTool::PaperFullText,
        AgentTool::GraphRagSearch,
        AgentTool::MemoryRecall,
        AgentTool::SubmissionDiagnosis,
    ];

    order
        .into_iter()
        .filter(|tool| tools.contains(tool))
        .map(AgentTool::descriptor)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::collect_tool_descriptors;

    #[test]
    fn paper_context_includes_full_text_tool() {
        let tools = collect_tool_descriptors(&["paper_analyst".to_string()], "paper");
        assert!(tools.iter().any(|tool| tool.name == "paper_full_text"));
    }

    #[test]
    fn interest_context_includes_research_context_tool() {
        let tools = collect_tool_descriptors(&["planner".to_string()], "interest");
        assert!(tools.iter().any(|tool| tool.name == "research_context"));
    }
}
