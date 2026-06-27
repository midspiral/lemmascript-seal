// Per-function contract extraction via LemmaScript's public `lsc info`.
//
// Resolution (matches the rest of the LemmaScript tool family): shell `lsc`
// from PATH by default (install with `npm i -g lemmascript`); set $LEMMASCRIPT
// to a sibling checkout to run its source through tsx instead (dev).
//
// `lsc info <file>` writes `<file>.json` next to the source — a map
// `{ symbol: { sig, requires, ensures, decreases } }`, where the spec text is
// the AST-derived contract (so the seal tracks MEANING, not source text). We
// read that file and remove it.
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import * as path from "node:path";

/** One verified function's contract, as `lsc info` reports it. */
export interface FnInfo {
  sig: string;
  requires: string[];
  ensures: string[];
  decreases: string | null;
}

function lscInvocation(): { cmd: string; pre: string[] } {
  const env = process.env.LEMMASCRIPT;
  if (env) {
    const lsc = path.join(env, "tools", "src", "lsc.ts");
    return { cmd: "npx", pre: ["--prefix", path.join(env, "tools"), "tsx", lsc] };
  }
  return { cmd: "lsc", pre: [] };
}

/** AST-derived per-function specs of one file: `{ symbol: FnInfo }`. */
export function infoOf(file: string): Record<string, FnInfo> {
  const { cmd, pre } = lscInvocation();
  try {
    execFileSync(cmd, [...pre, "info", file], { stdio: "ignore" });
  } catch (e) {
    throw new Error(`lsc info failed for ${file}: ${(e as Error).message}`);
  }
  const out = `${file}.json`;
  try {
    return JSON.parse(readFileSync(out, "utf8")) as Record<string, FnInfo>;
  } finally {
    rmSync(out, { force: true });
  }
}
