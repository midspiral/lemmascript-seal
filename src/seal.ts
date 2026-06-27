// The guarantee ledger.
//
// A GUARANTEE is one verified function's CONTRACT — its signature plus its
// requires/ensures/decreases. We hash the contract, NOT the body: the body is
// what the prover verifies; the contract is the promise we must never silently
// weaken. New symbols may be ADDED freely; existing entries may never change or
// disappear — the monotonicity invariant, mechanized.
//
// What this adds OVER the prover: a prover verifies whatever contract is in
// front of it — it will happily re-verify a *weakened* spec. Nothing in it
// enforces "guarantees only grow across edits." That cross-version freeze is
// this file's only job.
//
// The pure core (contractHash / sealLock / checkLock) takes plain data and
// returns plain data, so it is testable without LemmaScript; the I/O wrappers
// (guaranteesOf / readLock / writeLock) sit around it.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { infoOf, type FnInfo } from "./lsc.js";

/** A frozen contract: an entry in the ledger. `file:symbol` is the identity. */
export interface Guarantee {
  symbol: string;
  file: string;
  signature: string;
  requires: string[];
  ensures: string[];
  decreases: string | null;
  hash: string;
}

export interface Lock {
  note: string;
  sealedAt: string;
  sealed: Guarantee[];
}

export const LOCK_NOTE =
  "Guarantee ledger. Append-only. Each entry is a frozen contract; never edit or remove.";
export const SEALED_AT_PLACEHOLDER = "(set on first real commit)";

/** 64-bit truncation: collision-safe against accident, not a forging adversary —
 *  the full contract is stored alongside, so a forced collision must also read
 *  right on review (see README "Trust model"). */
const HASH_LEN = 16;

export const keyOf = (g: { file: string; symbol: string }): string => `${g.file}:${g.symbol}`;

/** Hash the contract in canonical form. Clause ORDER is irrelevant (a contract
 *  is a conjunction), so requires/ensures are sorted — reordering must not trip
 *  the seal; only a meaning change does. */
export function contractHash(info: FnInfo): string {
  const requires = [...info.requires].sort();
  const ensures = [...info.ensures].sort();
  const canonical = JSON.stringify({ sig: info.sig, requires, ensures, decreases: info.decreases ?? null });
  return createHash("sha256").update(canonical).digest("hex").slice(0, HASH_LEN);
}

export function toGuarantee(symbol: string, file: string, info: FnInfo): Guarantee {
  return {
    symbol,
    file,
    signature: info.sig,
    requires: [...info.requires].sort(),
    ensures: [...info.ensures].sort(),
    decreases: info.decreases ?? null,
    hash: contractHash(info),
  };
}

/** Extract every verified function's guarantee from the given files (runs `lsc info`). */
export function guaranteesOf(files: string[]): Guarantee[] {
  return files.flatMap((file) =>
    Object.entries(infoOf(file)).map(([symbol, info]) => toGuarantee(symbol, file, info)),
  );
}

export function emptyLock(): Lock {
  return { note: LOCK_NOTE, sealedAt: SEALED_AT_PLACEHOLDER, sealed: [] };
}

export function readLock(lockPath: string): Lock | null {
  if (!existsSync(lockPath)) return null;
  return JSON.parse(readFileSync(lockPath, "utf8")) as Lock;
}

export function writeLock(lockPath: string, lock: Lock): void {
  writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");
}

const bySymbol = (a: Guarantee, b: Guarantee): number =>
  (a.file + a.symbol).localeCompare(b.file + b.symbol);

/** Append-only seal (pure). Keeps every prior entry verbatim; refuses to
 *  overwrite a changed contract; admits genuinely new symbols. */
export function sealLock(current: Guarantee[], prior: Lock): { lock: Lock } | { refused: string } {
  const byKey = new Map(prior.sealed.map((g) => [keyOf(g), g]));
  for (const g of current) {
    const was = byKey.get(keyOf(g));
    if (was && was.hash !== g.hash) {
      return { refused: `${keyOf(g)} already sealed with a different contract. Seals are append-only.` };
    }
    if (!was) byKey.set(keyOf(g), g);
  }
  return {
    lock: {
      note: LOCK_NOTE,
      sealedAt: prior.sealedAt ?? SEALED_AT_PLACEHOLDER,
      sealed: [...byKey.values()].sort(bySymbol),
    },
  };
}

export interface CheckResult {
  /** Hard failures: a sealed contract was changed or removed (+ unsealed, in strict mode). */
  problems: string[];
  /** Verified symbols not yet in the ledger — a notice by default, a problem under `strict`. */
  unsealed: string[];
  /** Count of sealed guarantees that are intact. */
  intact: number;
}

/** Enforce the freeze (pure). Fails on any sealed contract changed/removed.
 *  Verified-but-unsealed symbols are a non-failing notice unless `strict`. */
export function checkLock(current: Guarantee[], lock: Lock, strict = false): CheckResult {
  const now = new Map(current.map((g) => [keyOf(g), g]));
  const problems: string[] = [];
  let intact = 0;
  for (const sealed of lock.sealed) {
    const live = now.get(keyOf(sealed));
    if (!live) {
      problems.push(`REMOVED: ${keyOf(sealed)} — a sealed guarantee disappeared`);
      continue;
    }
    if (live.hash !== sealed.hash) {
      problems.push(`CHANGED: ${keyOf(sealed)} — sealed contract was modified`);
      continue;
    }
    intact += 1;
  }
  const known = new Set(lock.sealed.map(keyOf));
  const unsealed = current.filter((g) => !known.has(keyOf(g))).map(keyOf);
  if (strict) {
    for (const k of unsealed) problems.push(`UNSEALED: ${k} — verified but not in the ledger; run 'seal'`);
  }
  return { problems, unsealed, intact };
}
