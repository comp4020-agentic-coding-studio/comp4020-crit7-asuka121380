// Prints every course's official requisite wording next to the planner's
// structured reading, for a person to review after any data refresh:
//   node scripts/audit-rules.ts [CODE ...]
import research from "../research/2027/courses.json" with { type: "json" };
import { overrides } from "../src/data/rule-overrides.ts";
import { buildRules, describe } from "../src/lib/rules.ts";

const only = process.argv.slice(2);
const courses = research.courses as Record<string, { requisiteText: string; assumedKnowledge: string; coTaught: string[] }>;
const tally: Record<string, number> = {};
for (const [code, c] of Object.entries(courses)) {
  if (only.length && !only.includes(code)) continue;
  const r = buildRules({ code, ...c }, overrides[code]);
  tally[`${r.confidence}/${r.review}`] = (tally[`${r.confidence}/${r.review}`] ?? 0) + 1;
  console.log(`\n### ${code}  [${r.confidence}, ${r.review}]${overrides[code] && r.review !== "hand-reviewed" ? "  ⚠ override is stale" : ""}`);
  console.log(c.requisiteText.replace(/^/gm, "  | ") || "  | (no requisite text)");
  if (r.prerequisite) console.log(`  prerequisite: ${r.prerequisite.type === "text" ? "(wording only)" : describe(r.prerequisite)}`);
  if (r.incompatible.length) console.log(`  incompatible: ${r.incompatible.join(", ")}`);
  for (const p of r.programRestrictions) console.log(`  program: ${p}`);
  for (const p of r.permission) console.log(`  permission: ${p}`);
  for (const p of r.otherConditions) console.log(`  other: ${p}`);
  if (r.coTaught.length) console.log(`  co-taught: ${r.coTaught.join(", ")}`);
}
console.log("\n", tally);
