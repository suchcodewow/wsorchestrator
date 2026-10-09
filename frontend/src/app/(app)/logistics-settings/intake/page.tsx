/** The Intake tab: the form a new bootcamp attendee fills in at /intake. */

import { getIntakeForm } from "@/lib/logistics/intake";
import { IntakeEditor } from "./intake-editor";

export default async function IntakeSettingsPage() {
  return <IntakeEditor form={await getIntakeForm()} />;
}
