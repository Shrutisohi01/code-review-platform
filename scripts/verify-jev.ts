import { existsSync, writeFileSync } from "node:fs";
import { JevClient, JevError, JEV_BASE_URL, loadJevConfig } from "../src/lib/jev";

const MARKER = ".jev-decision-check.json";
const wantDecision = process.argv.includes("--decision");

async function main() {
  const config = loadJevConfig(); // throws if the key is missing or base URL != pinned destination
  console.log(`destination: ${config.baseUrl} (pinned: ${config.baseUrl === JEV_BASE_URL})`);
  console.log("api key: present (not printed)");

  const client = new JevClient(config);
  const models = await client.listModels(); // GET /v1/models, no inference
  const names = models.models.map((m) => m.name);
  console.log(`models endpoint OK; ${names.length} models; ${config.model} available: ${names.includes(config.model)}`);
  if (!names.includes(config.model)) process.exit(2);

  if (!wantDecision) return console.log("Model check only. Run `npm run jev:decision` for the single decision call.");
  if (existsSync(MARKER) && !process.argv.includes("--force")) {
    console.log(`${MARKER} exists: the initial decision call was already attempted. Not re-sending.`);
    return;
  }
  writeFileSync(MARKER, JSON.stringify({ attemptedAt: new Date().toISOString() })); // written BEFORE the billable call
  const { response, billing } = await client.decide({
    state: { code: "function div(a, b) { return a / b; }" },
    questions: {
      division_by_zero: {
        type: "noul",
        instructions: "Can this function return Infinity or NaN because the divisor may be zero?",
      },
    },
  });
  console.log("decision OK:", JSON.stringify(response), "billing:", JSON.stringify(billing));
}

main().catch((e) => {
  console.error(e instanceof JevError ? `JEV error [${e.kind}${e.status ? " " + e.status : ""}]: ${e.message}` : "Unexpected failure");
  if (e instanceof JevError && e.outcomeUncertain) console.error("Outcome unknown: check usage before re-sending.");
  process.exit(1);
});
