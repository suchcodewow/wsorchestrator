/**
 * A line diff for the Code Lab: the longest common subsequence of two files'
 * lines, walked back into kept, removed and added lines. The files are a page
 * of HTML, so the quadratic table is a few thousand cells at most.
 */

export type DiffLine =
  | { kind: "same"; text: string; oldNo: number; newNo: number }
  | { kind: "del"; text: string; oldNo: number }
  | { kind: "add"; text: string; newNo: number };

export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  // lcs[i][j]: the longest common run of a[i..] and b[j..].
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      out.push({ kind: "same", text: a[i]!, oldNo: i + 1, newNo: j + 1 });
      i++;
      j++;
    } else if (j < b.length && (i === a.length || lcs[i]![j + 1]! > lcs[i + 1]![j]!)) {
      // On a tie the removal goes first, so a changed line reads old then new.
      out.push({ kind: "add", text: b[j]!, newNo: j + 1 });
      j++;
    } else {
      out.push({ kind: "del", text: a[i]!, oldNo: i + 1 });
      i++;
    }
  }
  return out;
}

/** How many lines a diff adds and removes. */
export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  return {
    added: lines.filter((l) => l.kind === "add").length,
    removed: lines.filter((l) => l.kind === "del").length,
  };
}

/**
 * The changed lines with `context` unchanged lines either side, in hunks; a
 * gap between hunks is where unchanged lines were left out.
 */
export function diffHunks(lines: DiffLine[], context = 2): DiffLine[][] {
  const keep = lines.map(() => false);
  lines.forEach((l, k) => {
    if (l.kind === "same") return;
    for (let n = Math.max(0, k - context); n <= Math.min(lines.length - 1, k + context); n++) keep[n] = true;
  });
  const hunks: DiffLine[][] = [];
  let current: DiffLine[] | null = null;
  lines.forEach((l, k) => {
    if (!keep[k]) {
      current = null;
      return;
    }
    if (!current) hunks.push((current = []));
    current.push(l);
  });
  return hunks;
}
