# lemmascript-seal

An **append-only guarantee ledger** for [LemmaScript](https://github.com/midspiral/LemmaScript)-verified
TypeScript. It freezes each verified function's *contract* so that, across edits, a
guarantee may be **added to** but **never silently changed or removed**.

```sh
lemmascript-seal seal   # (re)write SEALED.lock — append-only
lemmascript-seal check  # fail if any sealed contract changed or disappeared
```

## The problem it solves

A prover answers one question: *does this code satisfy the contract written above it?* It
re-checks whatever spec is in front of it — and will **happily verify a weaker spec**.
Nothing in the prover stops an edit that quietly relaxes a `//@ ensures`, deletes a
postcondition, or drops a whole verified function. The proof still "passes," because the
proof is only ever about the *current* file.

That gap matters whenever code evolves — and is fatal when an LLM agent is the one editing,
optimizing for "make it pass." `lemmascript-seal` is the missing monotonicity check:

> Across edits, a sealed guarantee may be **added to**, but **never changed or removed**.

The prover proves the present; the seal protects the past.

## What a "guarantee" is

One guarantee = one verified function's **contract**: its signature plus its
`requires` / `ensures` / `decreases`. Explicitly **not** the body.

- The **body** is what the prover verifies. If it's wrong, the proof fails — already covered.
- The **contract** is the promise the body is checked against. *That* is what must never
  silently weaken. So the ledger freezes the contract and ignores the body.

Contracts are read from `lsc info` (LemmaScript's AST-derived frontend), so the hash tracks
**meaning, not text** — reformatting, comments, whitespace, and clause reordering never
cause a false trip (`requires`/`ensures` are sorted before hashing; a contract is a
conjunction, so clause order is irrelevant).

## Install

```sh
npm i -D lemmascript-seal
```

It shells out to `lsc info`, so it needs a LemmaScript toolchain:

- **default:** `lsc` on your `PATH` (`npm i -g lemmascript`);
- **dev override:** set `$LEMMASCRIPT` to a sibling checkout — it's run through `tsx`:
  ```sh
  LEMMASCRIPT=../LemmaScript lemmascript-seal check
  ```

## Usage

```sh
lemmascript-seal seal  [files...] [--files <list>] [--lock <path>]
lemmascript-seal check [files...] [--files <list>] [--lock <path>] [--strict]
lemmascript-seal files [--files <list>]
```

- **`seal`** — write the ledger (default `SEALED.lock`), append-only. Admits new symbols;
  **refuses** to overwrite a sealed contract whose hash changed (even to strengthen it —
  see below). Only ever grows the ledger.
- **`check`** — fail if any sealed contract was changed or removed. Verified symbols not yet
  in the ledger are a non-failing notice; `--strict` makes them a failure.
- **`files`** — print the resolved verified-file list (so a `verify` script can read the
  *same* source of truth).

### One source of truth for the file set

The freeze is only as good as the list of files it covers: if `seal`, `check`, and your
`verify` script carry separately-maintained lists, they drift — and a verified file silently
never gets frozen. So the file set comes from **one** list (one path per line; `#` comments
and blanks ignored), resolved as:

1. explicit positional args, else
2. `--files <path>`, else
3. `./lemmascript-files.txt`, else `./LemmaScript-files.txt`.

`seal` and `check` always resolve the same set; `lemmascript-seal files` lets `verify`
consume it too.

## The monotonicity rule

| Edit | prover | `check` | `seal` | Verdict |
|------|--------|---------|--------|---------|
| Add a new verified function | ✅ | ✅ (listed "new") | appends it | **allowed** |
| Strengthen an existing contract | ✅ | ❌ `CHANGED` | ❌ `REFUSED` | **blocked in place** |
| Weaken/relax an existing `ensures` | ✅ (!) | ❌ `CHANGED` | ❌ `REFUSED` | **blocked** — the point |
| Delete a verified function | ✅ | ❌ `REMOVED` | n/a | **blocked** |
| Reformat / reorder clauses / edit body only | ✅ | ✅ | no-op | **allowed** |

Strengthening is blocked **in place** too — deliberately. The ledger doesn't try to decide
whether a new contract implies the old one (that's a theorem in itself); any hash change to a
frozen symbol is refused. The sanctioned way to record a *stronger* guarantee is to **add a
new symbol** — a lemma proving the extra property — leaving the original frozen contract
intact. Guarantees accumulate; they never retract.

## Workflow

```sh
# author: edit the .ts contracts → gen → verify (the prover) → freeze new guarantees
lemmascript-seal seal
git commit            # wire `check` into a pre-commit hook / CI

# CI / pre-push: nothing weakened, and nothing verified is left unfrozen
lemmascript-seal check --strict
```

A typical gate runs `check` → prover `verify` → tests. Put the fast `check` on every commit;
the heavier proof/test run in CI.

## Trust model and limits

What the seal does **not** do, so it isn't over-trusted:

- **It does not run the prover.** A passing `check` says "no frozen contract changed," not
  "the code is correct." Run your prover separately; the seal is the freeze, not the proof.
- **It does not check bodies.** A contract can stay frozen while its implementation is
  rewritten; correctness of the new body is the prover's job.
- **It trusts `lsc info`.** The hash is only as faithful as the AST extraction — the same
  trust base as the proofs themselves.
- **`SEALED.lock` is trusted state.** `check` only iterates entries *in the lock*, so an edit
  that changes the code *and* deletes the matching lock entry passes. The mitigation is
  ordinary review: the lock is a small, sorted, committed artifact whose diff is
  human-readable, and the full contract is stored alongside each hash, so a tampered entry
  has to also look right on review. A change that touches `SEALED.lock` is a red flag by
  construction — an editing agent has no business rewriting the ledger.
- **64-bit hashes** (16 hex chars) — collision-safe against accident, not a forging
  adversary; combined with the stored full contract, good enough for a reviewed artifact.

The defense is a small, reviewable artifact plus a structural append-only rule — not
tamper-proofing.

## Tests

```sh
npm test                 # pure unit tests over the ledger core — no toolchain, runs anywhere
npm run test:integration # end-to-end: real `lsc` + Dafny (test/integration/)
```

`npm test` is self-contained (the append-only logic over fixtures). The integration suite runs
the real story — seal a verified file, weaken/delete/change a contract, watch the prover still
verify while `check` fails — so it needs `lsc` (`$LEMMASCRIPT` or a global `lemmascript`) and
`dafny`. It lives in its own dir so `npm test` keeps a clean glob, and it is **never skipped**:
a missing toolchain *fails* it rather than passing green, because a fail-to-run must not read as
success.

## License

MIT
