/** Which Harness replies are worth trying again. */

export const isRetryable = (status: number) => status === 429 || status >= 500;

const ALREADY_SATISFIED = [/already part of user group/i];

export const isDuplicate = (status: number, body: string) =>
  status === 409 ||
  /DUPLICATE_FIELD|already exists|duplicate/i.test(body) ||
  ALREADY_SATISFIED.some((sig) => sig.test(body));
