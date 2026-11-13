export interface DiffLine {
  type: "add" | "del" | "ctx";
  oldLine: number | null;
  newLine: number | null;
  text: string;
}
export interface DiffHunk {
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}
export interface DiffFile {
  oldPath: string | null;
  newPath: string | null;
  binary: boolean;
  hunks: DiffHunk[];
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function cleanPath(p: string): string | null {
  const t = p.split("\t")[0]!.trim().replace(/^"|"$/g, "");
  if (t === "/dev/null") return null;
  return t.replace(/^[ab]\//, "");
}

/** Parses a unified diff. Throws on input that has no recognizable file or hunk structure. */
export function parseUnifiedDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let hunk: DiffHunk | null = null;
  let oldN = 0;
  let newN = 0;
  let oldLeft = 0;
  let newLeft = 0;

  for (const raw of diff.replace(/\r\n/g, "\n").split("\n")) {
    if (hunk && (oldLeft > 0 || newLeft > 0)) {
      const c = raw[0];
      if (c === "\\") continue; // "\ No newline at end of file"
      if (c === "+") {
        hunk.lines.push({ type: "add", oldLine: null, newLine: newN++, text: raw.slice(1) });
        newLeft--;
        continue;
      }
      if (c === "-") {
        hunk.lines.push({ type: "del", oldLine: oldN++, newLine: null, text: raw.slice(1) });
        oldLeft--;
        continue;
      }
      if (c === " " || raw === "") {
        hunk.lines.push({ type: "ctx", oldLine: oldN++, newLine: newN++, text: raw.slice(1) });
        oldLeft--;
        newLeft--;
        continue;
      }
    }
    if (raw.startsWith("diff --git ")) {
      file = { oldPath: null, newPath: null, binary: false, hunks: [] };
      files.push(file);
      hunk = null;
      const m = /^diff --git a\/(.+) b\/(.+)$/.exec(raw);
      if (m) {
        file.oldPath = m[1]!;
        file.newPath = m[2]!;
      }
    } else if (raw.startsWith("--- ")) {
      if (!file || file.hunks.length) {
        file = { oldPath: null, newPath: null, binary: false, hunks: [] };
        files.push(file);
      }
      file.oldPath = cleanPath(raw.slice(4));
    } else if (raw.startsWith("+++ ") && file) {
      file.newPath = cleanPath(raw.slice(4));
    } else if (raw.startsWith("Binary files ") || raw.startsWith("GIT binary patch")) {
      if (file) file.binary = true;
    } else if (file && (raw.startsWith("rename to "))) {
      file.newPath = raw.slice("rename to ".length);
    } else {
      const m = HUNK.exec(raw);
      if (m && file) {
        oldN = Number(m[1]);
        newN = Number(m[3]);
        oldLeft = m[2] === undefined ? 1 : Number(m[2]);
        newLeft = m[4] === undefined ? 1 : Number(m[4]);
        hunk = { oldStart: oldN, newStart: newN, lines: [] };
        file.hunks.push(hunk);
      }
    }
  }
  if (!files.length || files.every((f) => !f.hunks.length && !f.binary)) {
    throw new Error("No unified diff content found.");
  }
  return files;
}

/** New-file line numbers of added lines. */
export function addedLines(f: DiffFile): number[] {
  return f.hunks.flatMap((h) => h.lines.filter((l) => l.type === "add").map((l) => l.newLine!));
}
