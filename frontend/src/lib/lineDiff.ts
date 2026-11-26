/**
 * Line-by-line comparison of two texts (longest common subsequence). Procedures are short,
 * so the simple O(n·m) table is fine. Blank lines are ignored; leading/trailing spaces don't count.
 */
export type DiffLine = { type: "same" | "added" | "removed"; text: string };

const lines = (text: string) => text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

export function lineDiff(before: string, after: string): DiffLine[] {
  const a = lines(before);
  const b = lines(after);
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      result.push({ type: "same", text: a[i] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      result.push({ type: "removed", text: a[i] });
      i += 1;
    } else {
      result.push({ type: "added", text: b[j] });
      j += 1;
    }
  }
  while (i < a.length) result.push({ type: "removed", text: a[i++] });
  while (j < b.length) result.push({ type: "added", text: b[j++] });
  return result;
}

export function hasChanges(diff: DiffLine[]): boolean {
  return diff.some((line) => line.type !== "same");
}
