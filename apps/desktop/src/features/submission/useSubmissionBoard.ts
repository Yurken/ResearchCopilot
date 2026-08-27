import { useEffect, useState } from "react";
import { submissionApi } from "../../lib/client";
import {
  KANBAN_COLS,
  formatLocalDate,
  parseLocalDate,
  rowToSubmission,
  type AddSubmissionFormState,
  type Submission,
} from "./shared";

const emptyAddSubmissionForm: AddSubmissionFormState = {
  title: "",
  venue: "",
  venueType: "conference",
  deadline: "",
};

export function useSubmissionBoard(onError?: (error: unknown) => void) {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [showAddSubModal, setShowAddSubModal] = useState(false);
  const [addSubForm, setAddSubForm] = useState<AddSubmissionFormState>(emptyAddSubmissionForm);

  useEffect(() => {
    let cancelled = false;

    submissionApi
      .list()
      .then((response) => {
        if (cancelled) {
          return;
        }

        setSubmissions(response.submissions.map(rowToSubmission));
      })
      .catch((error) => {
        onError?.(error);
      });

    return () => {
      cancelled = true;
    };
  }, [onError]);

  const moveSubmission = (id: string, direction: "prev" | "next") => {
    const currentSubmission = submissions.find((submission) => submission.id === id);
    if (!currentSubmission) {
      return;
    }

    const currentIndex = KANBAN_COLS.findIndex((column) => column.key === currentSubmission.status);
    const nextIndex = direction === "next" ? currentIndex + 1 : currentIndex - 1;
    if (nextIndex < 0 || nextIndex >= KANBAN_COLS.length) {
      return;
    }

    const status = KANBAN_COLS[nextIndex].key;
    const submittedAt =
      direction === "next" && currentSubmission.status === "writing" ? new Date() : currentSubmission.submittedAt;

    setSubmissions((currentSubmissions) =>
      currentSubmissions.map((submission) =>
        submission.id === id ? { ...submission, status, submittedAt } : submission
      )
    );

    submissionApi
      .update(id, {
        status,
        submittedAt: submittedAt ? formatLocalDate(submittedAt) : undefined,
      })
      .catch((error) => {
        setSubmissions((currentSubmissions) =>
          currentSubmissions.map((submission) =>
            submission.id === id && submission.status === status ? currentSubmission : submission
          )
        );
        onError?.(error);
      });
  };

  const handleAddSubmission = async () => {
    if (!addSubForm.title.trim() || !addSubForm.venue.trim()) {
      onError?.(new Error("请填写论文标题和目标期刊/会议"));
      return;
    }

    try {
      const response = await submissionApi.create({
        title: addSubForm.title.trim(),
        venueName: addSubForm.venue.trim(),
        venueType: addSubForm.venueType,
        status: "writing",
        deadline: addSubForm.deadline || undefined,
      });

      setSubmissions((currentSubmissions) => [
        ...currentSubmissions,
        {
          id: response.id,
          title: addSubForm.title.trim(),
          venue: addSubForm.venue.trim(),
          venueType: addSubForm.venueType,
          status: "writing",
          deadline: addSubForm.deadline ? parseLocalDate(addSubForm.deadline) : undefined,
        },
      ]);
      setShowAddSubModal(false);
      setAddSubForm(emptyAddSubmissionForm);
    } catch (error) {
      onError?.(error);
    }
  };

  return {
    submissions,
    showAddSubModal,
    addSubForm,
    setShowAddSubModal,
    setAddSubForm,
    moveSubmission,
    handleAddSubmission,
  };
}
