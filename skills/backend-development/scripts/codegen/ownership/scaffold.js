// Ownership of `once: true` files and the source roots they live in.
//
// `once` files (the event-sourcing runtime, plus aggregates/deciders) are
// scaffolded when absent and then belong to the project forever — the generator
// must never rewrite them, because they carry hand-written business logic.
//
// The bookkeeping that used to be stamped into those files as comments — which
// template a `once` file was born from, and which classes the team has taken
// over — lives in `<project>/generator-state.json`. See `state.js`. Nothing is
// stamped into the source any more: a source file carries no generator mark.

/** Groovy specs are only compiled from the Groovy source root. */
export const isSpecFile = (p) => /(Spec|Specification)\.groovy$/.test(p);

/**
 * A spec placed under the Java root is not a compile error — it emits no class
 * at all, and surefire then reports the test "does not exist". Silent, and
 * expensive to diagnose.
 */
export function misplacedSpecs(paths) {
  return paths.filter(isSpecFile);
}
