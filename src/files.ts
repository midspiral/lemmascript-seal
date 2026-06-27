// Resolving the verified-file set from ONE source of truth.
//
// The freeze is only as good as the file list it covers: if `seal` and `check`
// (and the consumer's `verify`) carry separately-maintained lists, they drift —
// a verified file silently never gets frozen. So scopes are derived from a
// single list file. Explicit CLI args override it. `lemmascript-seal files`
// prints the resolved list so a `verify` script can consume the SAME source.
//
// Format matches the LemmaScript toolchain's `check.sh`:
//   filepath [timeout_in_seconds] [extra dafny flags...]
// i.e. the first whitespace-delimited token is the path; any trailing
// timeout/flags belong to `verify`, not to us, so we drop them. (We also
// tolerate `#` comments and blank lines.)
import { existsSync, readFileSync } from "node:fs";

/** Default list filenames, in precedence order. */
export const DEFAULT_LISTS = ["lemmascript-files.txt", "LemmaScript-files.txt"];

export function parseList(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.replace(/#.*$/, "").trim())
    .filter(Boolean)
    .map((l) => l.split(/\s+/)[0]); // first token = filepath; ignore [timeout] [flags]
}

/**
 * Resolve the verified-file set: explicit `argFiles` win; otherwise read
 * `listPath` (or the first existing default list). Returns `[]` if nothing
 * resolves — the caller reports that.
 */
export function resolveFiles(argFiles: string[], listPath?: string): string[] {
  if (argFiles.length) return argFiles;
  const candidates = listPath ? [listPath] : DEFAULT_LISTS;
  for (const c of candidates) {
    if (existsSync(c)) return parseList(readFileSync(c, "utf8"));
  }
  return [];
}
