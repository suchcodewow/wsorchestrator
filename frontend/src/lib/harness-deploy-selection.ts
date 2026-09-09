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

/**
 * What a deploy actually put into the organization, kept as words rather than
 * ids so the record still reads after a template source is renamed or removed.
 */
export type DeployedContent = {
  /** The site's own org secrets and template sources went in. */
  official: boolean;
  /** The deploying user's own org secrets went in. */
  mySecrets: boolean;
  /** The user's own template sources copied in, named as they read at the time. */
  myTemplates: string[];
};

/**
 * A second deploy into the same organization adds to what is already there
 * rather than replacing it, so the record is the two runs put together.
 */
export const mergeDeployed = (
  earlier: DeployedContent | null,
  now: DeployedContent,
): DeployedContent => ({
  official: (earlier?.official ?? false) || now.official,
  mySecrets: (earlier?.mySecrets ?? false) || now.mySecrets,
  myTemplates: [
    ...new Set([...(earlier?.myTemplates ?? []), ...now.myTemplates]),
  ],
});

export const nothingDeployed = (content: DeployedContent) =>
  !content.official && !content.mySecrets && content.myTemplates.length === 0;
