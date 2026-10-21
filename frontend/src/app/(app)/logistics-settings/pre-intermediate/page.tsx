/** The Pre-Intermediate tab: the form an intermediate candidate in the current cohort fills in at /intake. */

import { getEditableIntakeForm } from "@/lib/logistics/intake";
import { IntakeEditor } from "../intake-editor";

export default async function PreIntermediateSettingsPage() {
  return (
    <IntakeEditor
      key="intermediate"
      id="intermediate"
      form={await getEditableIntakeForm("intermediate")}
    />
  );
}
