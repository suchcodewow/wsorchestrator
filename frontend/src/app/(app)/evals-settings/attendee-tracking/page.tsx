/** The Attendee Tracking tab: who has been through BTC and INT, and how they scored. */

import { listHistory } from "@/lib/evals/bootcamp-history";
import { employeeNamesByEmail } from "@/lib/evals/roster";
import { AttendeeTrackingView } from "./attendee-tracking-view";

export default async function AttendeeTrackingPage() {
  const [history, names] = await Promise.all([listHistory(), employeeNamesByEmail()]);

  return (
    <AttendeeTrackingView
      rows={history.map((h) => ({
        id: h.id,
        email: h.email,
        name: names.get(h.email) ?? null,
        btcDate: h.btcDate,
        intDate: h.intDate,
        btcScore: h.btcScore,
        intScore: h.intScore,
        btcIndividualScores: h.btcIndividualScores,
        intIndividualScores: h.intIndividualScores,
        updatedAt: h.updatedAt.toISOString(),
      }))}
      employeesImported={names.size > 0}
    />
  );
}
