import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { KnowledgeNote, Paper } from "@research-copilot/types";
import { apiClient, experimentApi, formatErrorMessage } from "../../../lib/client";
import { queueCopilotPaperHandoff } from "../../copilot/copilotHandoff";
import {
  buildPaperExperimentDraft,
  buildReaderResearchPrompt,
  type ReaderResearchAction,
} from "./shared";

export function useReaderResearchActions(
  paper: Paper | null,
  page: number,
  selection?: string,
  pageText?: string,
) {
  const navigate = useNavigate();
  const [pending, setPending] = useState<"note" | "experiment" | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [generatedNote, setGeneratedNote] = useState<KnowledgeNote | null>(null);

  const openCopilot = useCallback((action: ReaderResearchAction) => {
    if (!paper) return;
    const selectedText = action === "summarize-selection" ? selection?.trim() : undefined;
    queueCopilotPaperHandoff({
      contextId: paper.id,
      contextLabel: paper.title,
      page,
      selection: selectedText,
      prompt: buildReaderResearchPrompt(action, paper, page, selectedText, pageText),
    });
    navigate("/chat");
  }, [navigate, page, pageText, paper, selection]);

  const generateNote = useCallback(async (): Promise<KnowledgeNote | null> => {
    if (!paper || pending) return null;
    setPending("note");
    setError("");
    setMessage("");
    try {
      const note = await apiClient.papers.generateNote(paper.id);
      void apiClient.memory.add({
        type: "auto",
        action: "paper.generate_note",
        summary: `从阅读页为论文「${paper.title}」生成了知识笔记「${note.title}」`,
        detail: JSON.stringify({ paper_id: paper.id, note_id: note.id, page }),
      });
      setMessage("论文笔记已生成");
      setGeneratedNote(note);
      return note;
    } catch (cause) {
      setError(formatErrorMessage(cause));
      return null;
    } finally {
      setPending(null);
    }
  }, [page, paper, pending]);

  const createExperiment = useCallback(async () => {
    if (!paper || pending) return;
    setPending("experiment");
    setError("");
    setMessage("");
    try {
      const draft = buildPaperExperimentDraft(paper);
      const result = await experimentApi.create(draft);
      void apiClient.memory.add({
        type: "auto",
        action: "paper.create_experiment",
        summary: `从论文「${paper.title}」创建了复现实验「${draft.title}」`,
        detail: JSON.stringify({ paper_id: paper.id, experiment_id: result.id }),
      });
      navigate("/experiment");
    } catch (cause) {
      setError(formatErrorMessage(cause));
    } finally {
      setPending(null);
    }
  }, [navigate, paper, pending]);

  const openGeneratedNote = useCallback(() => {
    if (generatedNote) navigate(`/notes/${generatedNote.id}`, { state: { note: generatedNote } });
  }, [generatedNote, navigate]);

  return {
    pending,
    error,
    message,
    generatedNote,
    openCopilot,
    generateNote,
    openGeneratedNote,
    createExperiment,
  };
}
