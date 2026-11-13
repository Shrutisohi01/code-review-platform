import { z } from "zod";
import { JevError } from "./errors";

const questionId = z.string().min(1).max(64).regex(/^[A-Za-z0-9._-]+$/);
const instructions = z.string().min(1);

export const noulQuestion = z.object({
  type: z.literal("noul"),
  instructions,
  criteria: z.object({ true: z.string().optional(), false: z.string().optional() }).optional(),
});
export const choiceQuestion = z.object({
  type: z.literal("choice"),
  instructions,
  criteria: z
    .record(z.string(), z.string().nullable())
    .refine((o) => Object.keys(o).length >= 2 && Object.keys(o).length <= 255, "choice needs 2-255 options"),
});
export const scoreQuestion = z.object({
  type: z.literal("score"),
  instructions,
  criteria: z.array(z.string()).min(2).max(10),
});
export const question = z.discriminatedUnion("type", [noulQuestion, choiceQuestion, scoreQuestion]);
export type JevQuestion = z.infer<typeof question>;

export const MAX_BODY_BYTES = 256_000;

export const decisionRequest = z.object({
  model: z.string().min(1).optional(),
  state: z.union([z.string(), z.record(z.string(), z.unknown()), z.array(z.unknown())]),
  questions: z
    .record(questionId, question)
    .refine((q) => Object.keys(q).length >= 1 && Object.keys(q).length <= 64, "1-64 questions required"),
  session_id: z.string().min(1).max(256).optional(),
  user: z.string().min(1).max(256).optional(),
});
export type DecisionRequest = z.infer<typeof decisionRequest>;

export function validateDecisionRequest(req: unknown): DecisionRequest {
  const parsed = decisionRequest.safeParse(req);
  if (!parsed.success) {
    throw new JevError("invalid_request", `Invalid decision request: ${parsed.error.issues[0]?.message ?? "schema mismatch"}`);
  }
  if (new TextEncoder().encode(JSON.stringify(parsed.data)).length > MAX_BODY_BYTES) {
    throw new JevError("invalid_request", `Request body exceeds ${MAX_BODY_BYTES} bytes.`);
  }
  return parsed.data;
}

const prob = z.number().min(0).max(1);
export const answer = z.discriminatedUnion("type", [
  z.object({ type: z.literal("noul"), noul: prob }),
  z.object({
    type: z.literal("choice"),
    choice: z.string(),
    probabilities: z.record(z.string(), prob),
    confidence: prob,
  }),
  z.object({
    type: z.literal("score"),
    score: z.union([z.string(), z.number()]),
    legend: z.unknown().optional(),
    probabilities: z.unknown().optional(),
    confidence: prob.optional(),
  }),
]);

export const decisionResponse = z.object({
  model: z.string(),
  answers: z.record(z.string(), answer),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }).partial().optional(),
});
export type DecisionResponse = z.infer<typeof decisionResponse>;

export const modelsResponse = z.object({
  models: z.array(z.object({ name: z.string(), description: z.string().optional() }).passthrough()),
});
export type ModelsResponse = z.infer<typeof modelsResponse>;
