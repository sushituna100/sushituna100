/**
 * Kernel smoke test: evaluate every sample document and print mass properties.
 * Run with: npx tsx scripts/check-samples.ts
 * Exits non-zero if any document fails validation or evaluation.
 */

import fs from "node:fs";
import path from "node:path";
import { evaluateDocument } from "../src/kernel/evaluate";
import { formatMassProperties, measureBody } from "../src/kernel/measure";
import type { CadDocument } from "../src/kernel/types";
import { DEFAULT_MATERIAL } from "../src/kernel/types";
import { validateDocument } from "../src/kernel/validate";

const dir = path.resolve(process.cwd(), "projects/demo");
let failed = false;

for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".cad.json"))) {
  const doc = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as CadDocument;
  console.log(`\n=== ${file} ===`);

  const check = validateDocument(doc);
  if (!check.ok) {
    failed = true;
    console.error("  VALIDATION FAILED:");
    for (const e of check.errors) console.error(`   - ${e}`);
    continue;
  }

  const result = evaluateDocument(doc);
  if (result.errors.length > 0) {
    failed = true;
    console.error("  EVALUATION ERRORS:");
    for (const e of result.errors) console.error(`   - [${e.featureId}] ${e.message}`);
  }
  if (result.bodies.length === 0) {
    failed = true;
    console.error("  No bodies produced!");
  }
  for (const body of result.bodies) {
    console.log(formatMassProperties(measureBody(body, doc.material ?? DEFAULT_MATERIAL)));
  }
}

process.exit(failed ? 1 : 0);
