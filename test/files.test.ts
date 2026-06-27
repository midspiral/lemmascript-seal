// Tests for verified-file-list parsing. The list shares the LemmaScript
// `check.sh` format — `filepath [timeout] [extra flags]` — so we must take only
// the first token, never feed a timeout/flag to `lsc info` as a filename.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseList } from "../src/files.js";

test("bare paths, one per line", () => {
  assert.deepEqual(parseList("src/a.ts\nsrc/b.ts\n"), ["src/a.ts", "src/b.ts"]);
});

test("drops a trailing timeout and extra dafny flags (check.sh format)", () => {
  assert.deepEqual(
    parseList("src/a.ts\nsrc/slow.ts 120 --isolate-assertions\nsrc/b.ts 30\n"),
    ["src/a.ts", "src/slow.ts", "src/b.ts"],
  );
});

test("ignores blank lines and # comments", () => {
  assert.deepEqual(parseList("# the core\nsrc/a.ts\n\n  src/b.ts  # keep\n"), ["src/a.ts", "src/b.ts"]);
});
