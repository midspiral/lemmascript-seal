#!/usr/bin/env node
// lemmascript-seal — the append-only guarantee ledger for verified TypeScript.
//
//   lemmascript-seal seal  [files...] [--files <list>] [--lock <path>]
//   lemmascript-seal check [files...] [--files <list>] [--lock <path>] [--strict]
//   lemmascript-seal files [--files <list>]
//
// Files come from the positional args, or — for a single source of truth — from
// a list file (--files <path>, else ./lemmascript-files.txt or
// ./LemmaScript-files.txt). `seal` and `check` always resolve the SAME set.
//
//   seal   (re)write the ledger, append-only: refuses to overwrite a changed
//          contract; admits genuinely new symbols.
//   check  fail if any sealed contract changed or disappeared. --strict also
//          fails on a verified symbol that is not yet sealed.
//   files  print the resolved verified-file list (so `verify` can read it too).
//
// lsc resolution: `lsc` on PATH, or $LEMMASCRIPT pointing at a sibling checkout.
import { guaranteesOf, readLock, writeLock, sealLock, checkLock, emptyLock } from "./seal.js";
import { resolveFiles } from "./files.js";

const DEFAULT_LOCK = "SEALED.lock";

function usage(): never {
  console.error(
    "usage:\n" +
      "  lemmascript-seal seal  [files...] [--files <list>] [--lock <path>]\n" +
      "  lemmascript-seal check [files...] [--files <list>] [--lock <path>] [--strict]\n" +
      "  lemmascript-seal files [--files <list>]",
  );
  process.exit(2);
}

interface Args {
  cmd: string;
  files: string[];
  listPath?: string;
  lock: string;
  strict: boolean;
}

function parseArgs(argv: string[]): Args {
  const [cmd, ...rest] = argv;
  if (!cmd) usage();
  const files: string[] = [];
  let listPath: string | undefined;
  let lock = DEFAULT_LOCK;
  let strict = false;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--strict") strict = true;
    else if (a === "--files") {
      listPath = rest[++i];
      if (listPath === undefined) usage(); // flag without a value
    } else if (a === "--lock") {
      const v = rest[++i];
      if (v === undefined) usage();
      lock = v;
    } else if (a.startsWith("--")) usage();
    else files.push(a);
  }
  return { cmd, files, listPath, lock, strict };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const files = resolveFiles(args.files, args.listPath);

  if (args.cmd === "files") {
    if (!files.length) {
      console.error("no files: pass paths or provide a list (--files <path> / lemmascript-files.txt)");
      process.exit(2);
    }
    console.log(files.join("\n"));
    return;
  }

  if (args.cmd !== "seal" && args.cmd !== "check") usage();
  if (!files.length) {
    console.error("no files: pass paths or provide a list (--files <path> / lemmascript-files.txt)");
    process.exit(2);
  }

  const current = guaranteesOf(files);

  if (args.cmd === "seal") {
    const prior = readLock(args.lock) ?? emptyLock();
    const res = sealLock(current, prior);
    if ("refused" in res) {
      console.error(`REFUSED: ${res.refused}`);
      process.exit(1);
    }
    writeLock(args.lock, res.lock);
    console.log(`sealed ${res.lock.sealed.length} guarantees → ${args.lock}`);
    return;
  }

  // check
  const lock = readLock(args.lock);
  if (!lock) {
    console.error(`no ${args.lock} — run 'seal' first`);
    process.exit(2);
  }
  const { problems, unsealed, intact } = checkLock(current, lock, args.strict);
  if (problems.length) {
    console.error("SEAL-CHECK FAILED:");
    problems.forEach((p) => console.error("  " + p));
    process.exit(1);
  }
  console.log(
    `seal-check OK — ${intact} guarantees intact` +
      (unsealed.length ? `; ${unsealed.length} new (unsealed): ${unsealed.join(", ")}` : ""),
  );
}

main();
