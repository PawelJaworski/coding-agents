# Edit classification — when the agent may touch a generated file

The generator is deterministic: it inserts members the model grew and reconciles
headers. The agent owns **implementation** — method bodies, private members, helper
classes. The agent does **not** own the **contract** — public API shape, class hierarchy,
architecture.

## The rule

| Layer | Owner | Agent may... |
|-------|-------|-------------|
| **Contract** (public shape) | Generator | Never change: class signature, public method names/signatures, interfaces, package |
| **Implementation** (details) | Agent | Rewrite freely: method bodies (including `@Override`), private methods/fields, helper classes |

The agent is responsible for compilation. If a body rewrite breaks something, fix it.

## Classify before you touch a generated file

| # | Kind | Example | Where it belongs |
|---|------|---------|------------------|
| 1 | **Model change** | new event / command / read model / field | `<docs>/events.md`, `commands.md`, `readmodels.md`, `business-definitions-raw.md` — run codegen, it emits it |
| 2 | **Implementation change (allowed)** | rewrite a method body; make `risk` an enum; rename a value-object field; add a query over existing fields | the generated file itself — body rewrite needs nothing; structural changes (new type, renamed field) mean listing the path in `preserved` |
| 3 | **Stale generated member** | a member's body predates a model change nobody re-ran codegen for | run `node <skill>/scripts/codegen --next` — it will tell you |

**Body rewrites need no marker.** The generator's advisory compares bodies, but a body
that differs from the template is the agent's implementation choice — it compiles or it
doesn't. Only **structural deviations** (the file's shape differs from what the model
would emit) need declaring.

## Taking a class over from the model

The model is an abstraction; reality sometimes needs a type, structure or logic it
can't express (an enum, a range, a third-party type). When that's genuinely the case:

1. **Confirm it isn't a new field, event, or command** — those MUST go through the model,
   never this path.
2. **Make the minimal edit** to the generated file.
3. **Add its path to `"preserved"` in `generator-state.json`** — the whole declaration:
   ```json
   { "preserved": ["src/main/java/com/example/domain/PolicyCoverage.java"] }
   ```
   That is class-level on purpose. It silences the whole file, exactly as the generator
   treats it, and there is no per-member bookkeeping to get wrong.
4. **Explain the decision in a comment beside the code** that needs it. The reason lives
   with the code because the reason is a property of the code.
5. **Re-run `--check` or `--next`.** The class is reported `preserved by hand` and passes.

Afterwards the build is the feedback loop, and that is deliberate. Nothing monitors the
class for "has the deviation gone stale?" — if the model later requires something the
class does not meet, javac or a test names it. That is a better signal than a JSON claim
that can silently rot.

Adding Javadoc, validation, or any behavior that could equally live in a `*Decider` or a
projector member is NOT kind 2 — put logic in the right seam instead.

## Summary

- Generated files keep their **contract** (public shape) intact.
- The agent owns **implementation** — rewrite bodies, add private members, create helpers.
- Model says "no"; reality says "yes" → kind 2, mark it, done.
- Anything reactive — a file that's already gone stale, a scaffold that predates its
  template — isn't decided here. Run `--next` and follow its prompt.
