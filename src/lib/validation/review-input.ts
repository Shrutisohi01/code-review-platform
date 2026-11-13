import { z } from "zod";
import { FOCUSES, analysisMode } from "@/lib/review/types";

export const MAX_INPUT_BYTES = 100_000;
export const ALLOWED_EXTENSIONS = [
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rb", "go", "rs", "java", "kt", "swift", "c", "h", "cpp", "hpp", "cs",
  "php", "sh", "sql", "html", "css", "scss", "json", "yaml", "yml", "toml", "md", "txt", "vue", "svelte",
];

export function checkFilename(name: string): string | null {
  if (!name || name.length > 255 || /[\\\0]|\.\.\//.test(name)) return "Invalid file name.";
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.includes(ext)) return `Unsupported file type ".${ext}".`;
  return null;
}

const text = z
  .string()
  .min(1, "Input is empty.")
  .refine((s) => !s.includes("\0"), "Binary content is not supported.")
  .refine((s) => new TextEncoder().encode(s).length <= MAX_INPUT_BYTES, `Input exceeds ${MAX_INPUT_BYTES} bytes.`);

export const reviewInput = z.discriminatedUnion("mode", [
  z.object({
    mode: z.enum(["paste", "upload"]),
    filename: z.string().refine((n) => checkFilename(n) === null, "Invalid or unsupported file name."),
    code: text,
    focus: z.enum(FOCUSES as [string, ...string[]]),
    analysis: analysisMode.default("standard"),
  }),
  z.object({ mode: z.literal("diff"), diff: text, focus: z.enum(FOCUSES as [string, ...string[]]), analysis: analysisMode.default("standard") }),
]);
export type ReviewInput = z.infer<typeof reviewInput>;
