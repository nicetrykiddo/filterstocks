/**
 * Payload verifier: asserts every invariant the dashboard and its stats rely
 * on, so a broken scan fails the pipeline instead of publishing silently.
 *
 *   tsx scripts/verify.ts [public/scan.json]
 *
 * Checks (all must hold):
 *   - shape: 11 conditions, labels/abbrevs/slugs aligned, rows non-empty
 *   - rows: st is 11 chars, score == popcount(st), res has 11 readings,
 *     finite prices, positive volume fields where present
 *   - arithmetic: transitions sum to the universe; breadth stats match the
 *     rows; per-condition pass counts match the rows; condition value
 *     distributions match; sector sizes sum to the universe
 *   - history: breadthHist strictly ascending dates ending at `session`,
 *     every row's hist aligns with the breadth window, mean/n9 recomputed
 *   - ordering: rows sorted by score desc then symbol; no duplicate symbols
 */
import fs from "node:fs";
import path from "node:path";
import type { ScanResult } from "../src/lib/types";

const file = process.argv[2] ?? path.join(__dirname, "..", "public", "scan.json");
const scan = JSON.parse(fs.readFileSync(file, "utf8")) as ScanResult;

let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    console.error(`  FAIL ${msg}`);
  }
};

const rows = scan.rows;
console.log(`verifying ${file}: session ${scan.session}, ${rows.length} rows`);

// ---- shape ----
check(scan.labels.length === 11, `labels.length ${scan.labels.length}`);
check(scan.abbrevs.length === 11, "abbrevs.length");
check(scan.slugs.length === 11, "slugs.length");
check(scan.conditions.length === 11, "conditions.length");
check(scan.conds.length === 11, "conds.length");
check(scan.condValues.length === 11, "condValues.length");
check(rows.length > 0, "rows empty");
check(scan.breadthHist.length > 0, "breadthHist empty");
check(scan.session >= (scan.breadthHist[scan.breadthHist.length - 1]?.d ?? ""), "breadthHist ends before session");

// ---- rows ----
const seen = new Set<string>();
let prevSortKey: { score: number; symbol: string } | null = null;
for (const r of rows) {
  check(typeof r.symbol === "string" && r.symbol.length > 0, "row symbol missing");
  check(!seen.has(r.symbol), `duplicate symbol ${r.symbol}`);
  seen.add(r.symbol);
  check(r.st.length === 11, `${r.symbol}: st length ${r.st.length}`);
  check(/^[01]{11}$/.test(r.st), `${r.symbol}: st not a bitstring`);
  const pop = [...r.st].filter((c) => c === "1").length;
  check(r.score === pop, `${r.symbol}: score ${r.score} != popcount ${pop}`);
  check(r.res.length === 11, `${r.symbol}: res length ${r.res.length}`);
  check(Number.isFinite(r.close) && r.close > 0, `${r.symbol}: close ${r.close}`);
  check(Number.isFinite(r.volume) && r.volume >= 0, `${r.symbol}: volume ${r.volume}`);
  check(Number.isFinite(r.chgPct), `${r.symbol}: chgPct ${r.chgPct}`);
  check(r.score >= 0 && r.score <= 11, `${r.symbol}: score range`);
  check(r.hist.length === r.histDates.length, `${r.symbol}: hist/histDates length`);
  const key = { score: r.score, symbol: r.symbol };
  if (prevSortKey) {
    check(
      key.score < prevSortKey.score || (key.score === prevSortKey.score && key.symbol >= prevSortKey.symbol),
      `${r.symbol}: rows not sorted (score ${r.score} after ${prevSortKey.score})`,
    );
  }
  prevSortKey = key;
}

// ---- transitions ----
const t = scan.trans;
check(t.nUp + t.nDn + t.unchanged === rows.length, `transitions ${t.nUp}+${t.nDn}+${t.unchanged} != ${rows.length}`);
check(t.ups.length === t.nUp, `ups list ${t.ups.length} != nUp ${t.nUp}`);
check(t.dns.length === t.nDn, `dns list ${t.dns.length} != nDn ${t.nDn}`);
check(t.entered <= t.nUp && t.lost <= t.nDn, "entered/lost exceed movers");
for (const m of [...t.ups, ...t.dns]) {
  check(m.s !== m.p, `${m.symbol}: mover with equal scores`);
  check(seen.has(m.symbol), `${m.symbol}: mover not in rows`);
}
for (const m of t.ups) check(m.s > m.p, `${m.symbol}: upgrade without score gain`);
for (const m of t.dns) check(m.s < m.p, `${m.symbol}: downgrade without score loss`);

// ---- breadth vs rows ----
const b = scan.breadth;
const scores = rows.map((r) => r.score);
const median = (() => {
  const s = [...scores].sort((a, z) => a - z);
  return s[Math.floor(s.length / 2)];
})();
check(b.universe === rows.length, `breadth.universe ${b.universe} != ${rows.length}`);
check(
  Math.abs(b.mean - scores.reduce((a, c) => a + c, 0) / rows.length) < 0.002,
  `breadth.mean ${b.mean} mismatch`,
);
check(b.median === median, `breadth.median ${b.median} != ${median}`);
check(b.n9 === scores.filter((s) => s >= 9).length, "breadth.n9 mismatch");
check(b.n7 === scores.filter((s) => s >= 7).length, "breadth.n7 mismatch");
check(b.below5 === scores.filter((s) => s < 5).length, "breadth.below5 mismatch");
check(b.aboveMa20 <= b.withMa20, "aboveMa20 > withMa20");
check(scan.run.clean + scan.run.quar === scan.run.total, "run.total != clean + quar");
check(scan.run.clean === rows.length, `run.clean ${scan.run.clean} != rows ${rows.length}`);

// ---- per-condition stats vs rows ----
scan.conds.forEach((c, ci) => {
  const pass = rows.filter((r) => r.st[ci] === "1").length;
  check(c.pass === pass, `cond ${c.ab}: pass ${c.pass} != ${pass}`);
  check(c.n === rows.length, `cond ${c.ab}: n ${c.n} != ${rows.length}`);
  const dist = new Map<string, number>();
  for (const r of rows) dist.set(`${r.res[ci]}|${r.st[ci] === "1" ? "PASS" : "FAIL"}`, (dist.get(`${r.res[ci]}|${r.st[ci] === "1" ? "PASS" : "FAIL"}`) ?? 0) + 1);
  const got = scan.condValues[ci];
  const sum = got.reduce((a, x) => a + x.n, 0);
  check(sum === rows.length, `condValues ${c.ab}: sum ${sum} != ${rows.length}`);
  for (const e of got) {
    check(
      dist.get(`${e.v}|${e.s}`) === e.n,
      `condValues ${c.ab}: ${e.v}|${e.s} count ${e.n} != ${dist.get(`${e.v}|${e.s}`) ?? 0}`,
    );
  }
});

// ---- sectors ----
{
  const sum = scan.sectors.reduce((a, s) => a + s.n, 0);
  check(sum === rows.length, `sector sizes sum ${sum} != ${rows.length}`);
  const bySector = new Map<string, number>();
  for (const r of rows) bySector.set(r.sector, (bySector.get(r.sector) ?? 0) + 1);
  for (const s of scan.sectors) check(bySector.get(s.name) === s.n, `sector ${s.name}: n ${s.n} != ${bySector.get(s.name)}`);
  check(scan.sectors.every((s) => s.h.length === scan.breadthHist.length), `sector ${scan.sectors[0]?.name}: history length`);
}

// ---- breadth history ----
{
  let last = "";
  for (const p of scan.breadthHist) {
    check(p.d > last, `breadthHist not ascending at ${p.d}`);
    last = p.d;
  }
  check(last === scan.session, `breadthHist ends ${last}, session ${scan.session}`);
  const lastPoint = scan.breadthHist[scan.breadthHist.length - 1];
  check(lastPoint.n === rows.length, `last breadthHist n ${lastPoint.n} != ${rows.length}`);
  check(
    Math.abs(lastPoint.mean - b.mean) < 0.002 && lastPoint.n9 === b.n9,
    "last breadthHist point != today's breadth",
  );
}

// ---- universes/industries ----
for (const u of scan.universes) {
  const n = rows.filter((r) => r.idx.includes(u.tag)).length;
  check(u.n === n, `universe ${u.tag}: n ${u.n} != ${n}`);
}

if (failures) {
  console.error(`\n${failures} invariant failure(s)`);
  process.exit(1);
}
console.log("all invariants hold");
