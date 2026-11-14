/**
 * The Drive file id in a Google Slides link, as pasted from the address bar
 * or a share dialog. Pure, so the new-presentation dialog can check a link
 * as it is typed with the same rule the server applies.
 */

/** Drive ids are URL-safe base64; real ones run to 44 characters, so 20 is a safe floor. */
const FILE_ID = /^[A-Za-z0-9_-]{20,100}$/;

/**
 * `https://docs.google.com/presentation/d/<id>/edit?slide=…#slide=…` and its
 * variants (`/u/0/`, `/present`, `/pub`), or a bare id. Null when it is neither.
 */
export function slidesFileId(input: string): string | null {
  const text = input.trim();
  if (FILE_ID.test(text)) return text;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.hostname !== "docs.google.com") return null;
  const match = url.pathname.match(/\/presentation\/(?:u\/\d+\/)?d\/([^/]+)/);
  const id = match?.[1];
  return id && FILE_ID.test(id) ? id : null;
}

/** Where the deck opens for editing in Google. */
export const slidesEditUrl = (fileId: string) => `https://docs.google.com/presentation/d/${fileId}/edit`;
