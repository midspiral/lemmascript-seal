// End-to-end integration: the substrate's whole reason for existing — a bad
// self-edit that the PROVER still accepts but the SEAL rejects.
//
//   1. start with a verified LemmaScript fixture
//   2. seal its guarantees
//   3. make a bad self-edit (weaken an ensures / delete a fn / change a contract)
//   4. the proof, regenerated, STILL verifies (the prover is content)   ← needs Dafny
//   5. `seal-check` FAILS                                               ← the point
//
// Runs the REAL toolchain: `lsc info` (and, for step 4, `lsc check` + Dafny).
// Lives in its own dir so `npm test` (the pure, portable unit suite) keeps a
// clean `test/*.test.ts` glob; this is `npm run test:integration`. Crucially
// these tests are **never skipped**: a missing toolchain FAILS them rather than
// passing green — a fail-to-run must not read as success. Provide it with
// `LEMMASCRIPT=../LemmaScript` (a sibling checkout) or a global `lemmascript`,
// plus `dafny` on PATH.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { guaranteesOf, sealLock, checkLock, emptyLock, type Lock } from "../../src/seal.js";

/** Resolve how to run `lsc` (same logic as the library): $LEMMASCRIPT sibling, else PATH. */
function lscCmd(): { cmd: string; pre: string[] } | null {
  const env = process.env.LEMMASCRIPT;
  if (env && existsSync(path.join(env, "tools", "src", "lsc.ts"))) {
    return { cmd: "npx", pre: ["--prefix", path.join(env, "tools"), "tsx", path.join(env, "tools", "src", "lsc.ts")] };
  }
  try {
    execFileSync("sh", ["-c", "command -v lsc"], { stdio: "ignore" });
    return { cmd: "lsc", pre: [] };
  } catch {
    return null;
  }
}
function dafnyAvailable(): boolean {
  try {
    execFileSync("sh", ["-c", "command -v dafny"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const LSC = lscCmd();
const HAS_DAFNY = dafnyAvailable();
const NEED_LSC =
  "integration requires the LemmaScript toolchain — set $LEMMASCRIPT to a sibling checkout or install `lemmascript`. (Not skipped: a missing toolchain is a failure, not a pass.)";
const NEED_DAFNY =
  "integration requires `dafny` on PATH to show the prover still verifies the weakened spec. (Not skipped: a missing toolchain is a failure, not a pass.)";

/** Hard precondition — every integration test needs `lsc`. Fails (never skips) if absent. */
function requireLsc(): void {
  assert.ok(LSC, NEED_LSC);
}

const FIXTURE = `//@ backend dafny
export function inc(x: number): number {
  //@ verify
  //@ ensures \\result === x + 1
  //@ ensures \\result > x
  return x + 1;
}

export function clampLow(x: number): number {
  //@ verify
  //@ ensures \\result >= 0
  //@ ensures \\result >= x
  return x > 0 ? x : 0;
}
`;

function withFixture(content: string, body: (file: string) => void): void {
  const dir = mkdtempSync(path.join(tmpdir(), "lseal-"));
  try {
    const file = path.join(dir, "inc.ts");
    writeFileSync(file, content);
    body(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function seal(file: string): Lock {
  const res = sealLock(guaranteesOf([file]), emptyLock());
  if (!("lock" in res)) throw new Error(`seal refused: ${res.refused}`);
  return res.lock;
}

/** Regenerate the proof from the (edited) .ts and run Dafny; return its output. */
function reverify(file: string): string {
  for (const ext of [".dfy", ".dfy.gen"]) rmSync(file.replace(/\.ts$/, ext), { force: true });
  return execFileSync(LSC!.cmd, [...LSC!.pre, "check", "--backend=dafny", file], { encoding: "utf8" });
}

test("the fixture seals to two guarantees", () => {
  requireLsc();
  withFixture(FIXTURE, (file) => {
    const lock = seal(file);
    assert.deepEqual(
      lock.sealed.map((g) => g.symbol).sort(),
      ["clampLow", "inc"],
    );
  });
});

test("weakened ensures: prover still verifies, seal-check FAILS (CHANGED)", () => {
  requireLsc();
  assert.ok(HAS_DAFNY, NEED_DAFNY);
  withFixture(FIXTURE, (file) => {
    // 1+2: seal the verified fixture.
    const lock = seal(file);

    // 3: the bad self-edit — weaken inc's `> x` to `>= x` (strictly weaker, still true).
    writeFileSync(file, FIXTURE.replace("\\result > x", "\\result >= x"));

    // 4: regenerate the proof and verify — the prover is content with the weaker spec.
    assert.match(reverify(file), /0 errors/, "the weakened spec should still verify");

    // 5: the seal catches what the prover missed.
    const res = checkLock(guaranteesOf([file]), lock);
    assert.equal(res.problems.length, 1);
    assert.match(res.problems[0], /^CHANGED: .*inc\.ts:inc /);
  });
});

test("deleted function: prover still verifies, seal-check FAILS (REMOVED)", () => {
  requireLsc();
  assert.ok(HAS_DAFNY, NEED_DAFNY);
  withFixture(FIXTURE, (file) => {
    const lock = seal(file);
    // delete clampLow entirely; inc is untouched.
    writeFileSync(file, FIXTURE.split("export function clampLow")[0].trimEnd() + "\n");
    // the remaining module still verifies — the prover has nothing to say about a vanished guarantee.
    assert.match(reverify(file), /0 errors/, "the module without clampLow should still verify");
    const res = checkLock(guaranteesOf([file]), lock);
    assert.equal(res.problems.length, 1);
    assert.match(res.problems[0], /^REMOVED: .*inc\.ts:clampLow /);
  });
});

test("strengthened-in-place: prover still verifies, seal-check FAILS (CHANGED)", () => {
  requireLsc();
  assert.ok(HAS_DAFNY, NEED_DAFNY);
  withFixture(FIXTURE, (file) => {
    const lock = seal(file);
    // add a (true, stronger) ensures to inc — strengthening in place is still a change.
    writeFileSync(file, FIXTURE.replace("  //@ ensures \\result > x\n", "  //@ ensures \\result > x\n  //@ ensures \\result >= x + 1\n"));
    // the stronger spec still verifies — the prover is content; the seal still refuses the in-place change.
    assert.match(reverify(file), /0 errors/, "the stronger spec should still verify");
    const res = checkLock(guaranteesOf([file]), lock);
    assert.equal(res.problems.length, 1);
    assert.match(res.problems[0], /^CHANGED: .*inc\.ts:inc /);
  });
});
