/** One assessment, open for editing. */

import { notFound } from "next/navigation";
import { z } from "zod";
import { getAssessment } from "@/lib/evals/assessments";
import { AssessmentEditor } from "../assessment-editor";

export default async function AssessmentPage({ params }: { params: Promise<{ id: string }> }) {
  const id = z.string().uuid().safeParse((await params).id);
  const assessment = id.success ? await getAssessment(id.data) : null;
  if (!assessment) notFound();

  return (
    <AssessmentEditor
      assessment={{
        ...assessment,
        createdAt: assessment.createdAt.toISOString(),
        updatedAt: assessment.updatedAt.toISOString(),
      }}
    />
  );
}
