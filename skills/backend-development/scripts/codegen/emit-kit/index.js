// Shared emit kit: the primitives every step's emitters build Java from.
// Pure functions of the model — no step knows about another step's constructs.
//
// Ownership rule (carried on the files these help produce):
//   * `overwrite: true, logic: false` -> data/contract files, reconciled add-only.
//   * `overwrite: true, logic: true`  -> logic classes (handlers, projectors,
//                                        repositories, entities): scaffolded once,
//                                        then the project's. Model drift is reported
//                                        as an advisory, never applied over hand edits.
//   * `once: true`                    -> scaffolded once if absent, then owned by TDD.
//                                        Contains the UnsupportedOperationException
//                                        stubs for [bracketed] fields, i.e. the only
//                                        places where business decisions live.
// There is no header on a GENERATED file, deliberately. "Is this generated, and
// what may I do to it?" is answered by `codegen --patch` — from the model, always
// currently, and per verb. A comment saying the same thing is a CACHED answer: it
// costs a line in every file, it can go stale (an element deleted from the model
// leaves a file still claiming to come from it), and nothing reads it. Proven: with
// the line stripped, --patch and --check classify identically.
//
// The two facts a comment cannot derive belong in generator-state.json, not here
// (ownership/state.js):
//   scaffoldVersions   which template a `once` file was born from. Its body has
//                      since diverged, so this is unrecoverable from content.
//                      Pure metadata — it never needed to be near the code.
//   preserved          which classes the team has taken over from the model.
//                      The only way to close an UPDATE; without it the entry
//                      recurs forever.
//
// Neither is stamped back into the source — not even as a breadcrumb. A
// declaration is class-level because that is the granularity the generator acts
// on, and the why belongs in a comment beside the code that needs it.

// Aggregates/deciders are `once`, so they version the same way as the runtime.
// Bump SCAFFOLD_VERSION only if the SHAPE of a scaffolded once-file changes
// (not when the model gains a field — a missing stub is already a loud javac error
// naming the exact method).
export const SCAFFOLD_VERSION = 1;

export const uniq = (xs) => [...new Set(xs)].filter(Boolean);
export const importBlock = (imports) =>
  uniq(imports).sort().map((i) => `import ${i};`).join('\n');

export const components = (fields) => fields.map((f) => `${f.javaType} ${f.name}`).join(', ');

// --- collaborators -----------------------------------------------------------
// A collaborator is a constructor dependency of a generated class. The generator
// knows only three things about one: what to declare as a field, how a TEST
// instantiates it, and (optionally) a file to scaffold for it.
//
// It deliberately does NOT know what the dependency MEANS. A validator, a clock,
// a sequence or an ID generator would be
// added as another producer of this same shape, touching no emitter and no
// call site, because every emitter below consumes the LIST, never a named flag.
//
//   fieldName          constructor field name (Lombok @RequiredArgsConstructor
//                      derives the ctor signature from declaration order)
//   className          declared type
//   testInstantiation  expression a *Ability uses to build/obtain it. Varies by
//                      kind — `Clock.systemUTC()` for a runtime collaborator,
//                      `new FooDecider()` for a fresh projection decider, a shared
//                      static like `FooAbility.FOO_REPOSITORY` for a registered
//                      one — which is exactly why this is per-collaborator data
//                      and not a rule baked into the ability emitter.
//   imports            imports the declaration needs (may be empty/same package)
//   scaffold           optional () => file, emitted alongside the owner
export const collaborator = ({ fieldName, className, testInstantiation, imports = [], scaffold = null }) => ({
  fieldName,
  className,
  testInstantiation,
  imports,
  scaffold,
});

export const fieldDeclarations = (collaborators) =>
  collaborators.map((c) => `    private final ${c.className} ${c.fieldName};`).join('\n');

export const constructorArgs = (collaborators) =>
  collaborators.map((c) => c.testInstantiation).join(', ');

export const collaboratorImports = (collaborators) => collaborators.flatMap((c) => c.imports);

export const collaboratorScaffolds = (collaborators) =>
  collaborators.filter((c) => c.scaffold).map((c) => c.scaffold());

// --- expression resolution for a target field --------------------------------
// This is where the [bracket] convention pays off: everything derivable is
// derived; anything that is not is DELEGATED to a collaborator. `delegate`
// names the collaborator field and the arguments to pass it — the resolver
// itself has no notion of what that collaborator is for.
export function resolveArg(field, { sourceFields, sourceExpr, delegate, fallback }) {
  // The implicit identity attribute IS the aggregate id: every event carries it,
  // so it can never come from a name match, a decider or a state fallback.
  if (field.identity) return { expr: `${sourceExpr}.aggregateId()`, imports: field.imports };
  if (field.convention) return { expr: field.conventionExpr, imports: field.imports };
  if (field.bracketed) {
    return {
      expr: `${delegate.fieldName}.${field.name}(${delegate.args ?? ''})`,
      imports: [],
      delegated: true,
    };
  }
  // A (list)/nested "* *" field that parse.js could not derive automatically
  // from its subscribed events (see markUnmappableReadModelFields) is never
  // silently mismapped to a same-named-but-different-shape event field or a
  // stale-state fallback. It is delegated to the read model's decider, same as
  // a [bracketed] field, whose generated stub throws explaining why — this
  // keeps the rest of the projector (and the whole codegen run) generating
  // normally instead of aborting.
  if (field.unmappable) {
    return {
      expr: `${delegate.fieldName}.${field.name}(${delegate.args ?? ''})`,
      imports: [],
      delegated: true,
    };
  }
  const match = sourceFields.find((f) => f.name === field.name);
  if (match) {
    if (!hasSameStructuredShape(field, match)) {
      throw new Error(
        `Unsupported structured-field mapping for "${field.label}": the source and target ` +
          `do not have the same (list)/nested "* *" shape. Add a more detailed mapping ` +
          `prompt before generating this projector or handler; the generator will not guess.`,
      );
    }
    return { expr: `${sourceExpr}.${field.name}()`, imports: [] };
  }
  if (fallback) return { expr: fallback(field), imports: [] };
  return null;
}

function hasSameStructuredShape(target, source) {
  const children = (field) => field.children || [];
  if (Boolean(target.list) !== Boolean(source.list)) return false;
  const targetChildren = children(target);
  const sourceChildren = children(source);
  if (targetChildren.length !== sourceChildren.length) return false;
  return targetChildren.every((child, index) =>
    child.name === sourceChildren[index].name && hasSameStructuredShape(child, sourceChildren[index]),
  );
}

