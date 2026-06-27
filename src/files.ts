// Resolving the verified-file set from ONE source of truth.
//
// The freeze is only as good as the file list it covers: if `seal` and `check`
// (and the consumer's `verify`) carry separately-maintained lists, they drift —
// a verified file silently never gets frozen. So scopes are derived from a
// single list file (one path per line; `#` comments and blanks ignored).
// Explicit CLI args override it. `lemmascript-seal files` prints the resolved
// list so a `verify` script can consume the SAME source.
import { existsSync, readFileSync } from "node:fs";

/** Default list filenames, in precedence order. */
export const DEFAULT_LISTS = ["lemmascript-files.txt", "LemmaScript-files.txt"];

export function parseList(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.replace(/#.*$/, "").trim())
    .filter(Boolean);
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
