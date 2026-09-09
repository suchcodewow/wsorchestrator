/** What the person deploying ticked, shaped the same on both sides of the wire. */

export type DeploySelection = {
  /** The site's own org secrets and template sources. */
  official: boolean;
  /** The deploying user's own org secrets. */
  mySecrets: boolean;
  /** The ids of the deploying user's own template sources to copy. */
  myTemplates: string[];
};

export const nothingSelected = (selection: DeploySelection) =>
  !selection.official &&
  !selection.mySecrets &&
  selection.myTemplates.length === 0;
