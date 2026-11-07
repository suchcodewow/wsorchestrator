/** What a Diagnostic reminder says. Pure, so the run, its log and the unit test share it. */

import { SUBJECTS, type SubjectKey } from "@/lib/iris/subjects";

/** Where one Participant stands on the subjects open to them, in subject order. */
export type ReminderStatus = {
  done: SubjectKey[];
  started: SubjectKey[];
  notStarted: SubjectKey[];
};

const names = (keys: SubjectKey[]) => keys.map((k) => SUBJECTS[k].name).join(", ");

/** Their first name, as `employees.full_name` and account names put it first. */
function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? "";
}

/** The direct message, in Slack's mrkdwn, ending with a link to their tests. */
export function reminderText(fullName: string, status: ReminderStatus, link: string): string {
  const total = status.done.length + status.started.length + status.notStarted.length;
  const left = total - status.done.length;
  const first = firstName(fullName);
  const lines = [
    `${first ? `Hi ${first}, a` : "A"} reminder: you have ${left} of ${total} Diagnostic placement ${total === 1 ? "test" : "tests"} left to take.`,
    "",
  ];
  if (status.done.length) lines.push(`*Done:* ${names(status.done)}`);
  if (status.started.length) lines.push(`*Started, not finished:* ${names(status.started)}`);
  if (status.notStarted.length) lines.push(`*Not started:* ${names(status.notStarted)}`);
  lines.push("", `<${link}|Click to take diagnostic tests>`);
  return lines.join("\n");
}
