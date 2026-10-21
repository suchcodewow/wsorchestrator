/** The Pre-Bootcamp tab: the form a bootcamp candidate in the current cohort fills in at /intake. */

import { getEditableIntakeForm } from "@/lib/logistics/intake";
import { IntakeEditor } from "../intake-editor";

export default async function PreBootcampSettingsPage() {
  return (
    <IntakeEditor
      key="bootcamp"
      id="bootcamp"
      form={await getEditableIntakeForm("bootcamp")}
    />
  );
}
