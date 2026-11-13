import { DiffFile, parseUnifiedDiff } from "./diff";
import { SourceFile } from "./types";

const pad = (n: number | string) => String(n).padStart(5, " ");

export function sourceFromCode(path: string, code: string): SourceFile {
  const arr = code.replace(/\r\n/g, "\n").split("\n");
  const lines = new Map(arr.map((t, i) => [i + 1, t] as const));
  return {
    path,
    lines,
    changedLines: null,
    render: (s, e) => {
      const out: string[] = [];
      for (let n = s; n <= e; n++) if (lines.has(n)) out.push(`${pad(n)}| ${lines.get(n)}`);
      return out.join("\n");
    },
  };
}

export function sourcesFromDiff(diff: string): { sources: SourceFile[]; skipped: string[] } {
  const parsed: DiffFile[] = parseUnifiedDiff(diff);
  const sources: SourceFile[] = [];
  const skipped: string[] = [];
  for (const f of parsed) {
    const path = f.newPath;
    if (!path) continue; // deletions: nothing new to review
    if (f.binary || !f.hunks.length) {
      skipped.push(path);
      continue;
    }
    const lines = new Map<number, string>();
    const changed = new Set<number>();
    for (const h of f.hunks) {
      for (const l of h.lines) {
        if (l.newLine !== null) {
          lines.set(l.newLine, l.text);
          if (l.type === "add") changed.add(l.newLine);
        }
      }
    }
    sources.push({
      path,
      lines,
      changedLines: changed,
      render: (s, e) => {
        const out: string[] = [];
        for (const h of f.hunks) {
          for (const l of h.lines) {
            if (l.newLine !== null && l.newLine >= s && l.newLine <= e) {
              out.push(`${pad(l.newLine)}| ${l.type === "add" ? "+" : " "}${l.text}`);
            } else if (l.type === "del" && lastNew(h.lines, l) >= s - 1 && lastNew(h.lines, l) < e) {
              out.push(`${pad("-")}| -${l.text}`);
            }
          }
        }
        return out.join("\n");
      },
    });
  }
  if (!sources.length && !skipped.length) throw new Error("The diff contains no reviewable files.");
  return { sources, skipped };
}

/** New-side line number of the nearest preceding non-deleted line in the hunk (0 if none). */
function lastNew(lines: { newLine: number | null }[], target: object): number {
  let last = 0;
  for (const l of lines) {
    if (l === target) return last;
    if (l.newLine !== null) last = l.newLine;
  }
  return last;
}
