// Unit tests for the pure ledger core — no LemmaScript needed: we feed FnInfo /
// Guarantee fixtures directly and assert the append-only behavior.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  contractHash,
  toGuarantee,
  sealLock,
  checkLock,
  emptyLock,
  keyOf,
  type Lock,
} from "../src/seal.js";
import type { FnInfo } from "../src/lsc.js";

const info = (over: Partial<FnInfo> = {}): FnInfo => ({
  sig: "(x: int): bool",
  requires: [],
  ensures: ["\\result === true"],
  decreases: null,
  ...over,
});

const lockOf = (gs: ReturnType<typeof toGuarantee>[]): Lock => ({ ...emptyLock(), sealed: gs });

test("hash is stable under clause reordering (a contract is a conjunction)", () => {
  const a = info({ requires: ["0 <= x", "x < 10"], ensures: ["p", "q", "r"] });
  const b = info({ requires: ["x < 10", "0 <= x"], ensures: ["r", "p", "q"] });
  assert.equal(contractHash(a), contractHash(b));
});

test("hash is sensitive to a meaning change (weakened ensures)", () => {
  const strong = info({ ensures: ["\\result === f(x)"] });
  const weak = info({ ensures: ["\\result === f(x) || \\result === 0"] });
  assert.notEqual(contractHash(strong), contractHash(weak));
});

test("hash is sensitive to a signature change", () => {
  assert.notEqual(contractHash(info({ sig: "(x: int): bool" })), contractHash(info({ sig: "(x: nat): bool" })));
});

test("seal admits a new symbol and preserves prior entries verbatim", () => {
  const g1 = toGuarantee("f", "src/a.ts", info());
  const g2 = toGuarantee("g", "src/a.ts", info({ ensures: ["other"] }));
  const res = sealLock([g1, g2], lockOf([g1]));
  assert.ok("lock" in res);
  if ("lock" in res) {
    assert.equal(res.lock.sealed.length, 2);
    assert.deepEqual(res.lock.sealed.map(keyOf).sort(), ["src/a.ts:f", "src/a.ts:g"]);
  }
});

test("seal REFUSES overwriting a sealed contract with a different hash", () => {
  const sealed = toGuarantee("f", "src/a.ts", info({ ensures: ["strong"] }));
  const weakened = toGuarantee("f", "src/a.ts", info({ ensures: ["weak"] }));
  const res = sealLock([weakened], lockOf([sealed]));
  assert.ok("refused" in res);
});

test("seal is a no-op (idempotent) when nothing changed", () => {
  const g = toGuarantee("f", "src/a.ts", info());
  const res = sealLock([g], lockOf([g]));
  assert.ok("lock" in res);
  if ("lock" in res) assert.deepEqual(res.lock.sealed, [g]);
});

test("same symbol name in two files are distinct guarantees", () => {
  const a = toGuarantee("fireOnce", "src/a.ts", info());
  const b = toGuarantee("fireOnce", "src/ext/b.ts", info({ ensures: ["different"] }));
  const res = sealLock([a, b], emptyLock());
  assert.ok("lock" in res);
  if ("lock" in res) assert.equal(res.lock.sealed.length, 2);
});

test("check fails on a CHANGED contract", () => {
  const sealed = toGuarantee("f", "src/a.ts", info({ ensures: ["strong"] }));
  const live = toGuarantee("f", "src/a.ts", info({ ensures: ["weak"] }));
  const { problems } = checkLock([live], lockOf([sealed]));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^CHANGED: src\/a\.ts:f/);
});

test("check fails on a REMOVED contract", () => {
  const sealed = toGuarantee("f", "src/a.ts", info());
  const { problems } = checkLock([], lockOf([sealed]));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^REMOVED: src\/a\.ts:f/);
});

test("check is clean when contracts are intact, and reports unsealed as a notice", () => {
  const sealed = toGuarantee("f", "src/a.ts", info());
  const fresh = toGuarantee("g", "src/a.ts", info({ ensures: ["new"] }));
  const { problems, unsealed, intact } = checkLock([sealed, fresh], lockOf([sealed]));
  assert.equal(problems.length, 0);
  assert.equal(intact, 1);
  assert.deepEqual(unsealed, ["src/a.ts:g"]);
});

test("--strict turns a verified-but-unsealed symbol into a failure", () => {
  const sealed = toGuarantee("f", "src/a.ts", info());
  const fresh = toGuarantee("g", "src/a.ts", info({ ensures: ["new"] }));
  const { problems } = checkLock([sealed, fresh], lockOf([sealed]), true);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^UNSEALED: src\/a\.ts:g/);
});
