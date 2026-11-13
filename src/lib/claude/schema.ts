import { z } from "zod";

const severity = z.enum(["critical", "high", "medium", "low", "informational"]);
const category = z.enum(["bug", "security", "performance", "maintainability", "testing"]);

/** Application-level contract Claude is asked to follow. Not a native Anthropic response format. */
export const claudeFinding = z.object({
  /** Id of the JEV candidate being assessed; null for an issue Claude found on its own. */
  candidate_id: z.string().nullable(),
  /** false = the suspected issue is not substantiated by the code shown. */
  is_valid: z.boolean(),
  title: z.string(),
  severity,
  category,
  file_path: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  /** Quote or paraphrase the code that supports the verdict (or explain what is missing). */
  evidence: z.string(),
  description: z.string(),
  impact: z.string().nullable(),
  suggested_fix: z.string().nullable(),
  suggested_code: z.string().nullable(),
  /** Missing context or caveats. */
  uncertainty: z.string().nullable(),
  /** The model's own qualitative assessment. Not a measured accuracy. */
  confidence: z.enum(["low", "medium", "high"]),
});
export type ClaudeFinding = z.infer<typeof claudeFinding>;

export const analysisOutput = z.object({ findings: z.array(claudeFinding) });
export type AnalysisOutput = z.infer<typeof analysisOutput>;
