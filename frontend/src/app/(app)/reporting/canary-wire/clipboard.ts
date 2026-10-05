/**
 * Puts a report on the clipboard in both flavours at once: Slack's composer
 * and Gmail take the HTML and keep its links, and anywhere plain takes the
 * text. `writeText` alone can carry only one, so it is the fallback, and a
 * selected off-screen element the last resort for a browser with neither.
 */
export async function copyRich({ text, html }: { text: string; html: string }): Promise<boolean> {
  if (navigator.clipboard && typeof ClipboardItem !== "undefined") {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
      return true;
    } catch {
      // fall through
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // fall through
  }

  // Rendered HTML, selected and copied, carries the rich flavour too, where a
  // textarea would throw the links away. `html` is built from escaped values.
  const host = document.createElement("div");
  host.contentEditable = "true";
  host.innerHTML = html;
  Object.assign(host.style, { position: "fixed", left: "-9999px", whiteSpace: "pre-wrap" });
  document.body.append(host);
  const range = document.createRange();
  range.selectNodeContents(host);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  selection?.removeAllRanges();
  host.remove();
  return ok;
}
