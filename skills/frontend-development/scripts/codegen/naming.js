// Deterministic name derivation for the frontend generator. Pure function of the
// model — nothing here reads the filesystem, so "does component X exist?" is
// decidable from the model alone and no code index is ever needed.

const words = (s) => String(s).trim().toLowerCase().split(/[\s\-_]+/).filter(Boolean);

const pascal = (s) => words(s).map((w) => w[0].toUpperCase() + w.slice(1)).join('');
const camel = (s) => {
  const p = pascal(s);
  return p[0].toLowerCase() + p.slice(1);
};
const kebab = (s) => words(s).join('-');

const naming = {
  words,
  pascal,
  camel,
  kebab,

  // One html UI -> one page folder. File names follow the Angular 21 convention
  // already used in this repo (home/home.ts exporting `Home`), not the legacy
  // *.component.ts naming.
  page: (id) => ({
    dir: kebab(id),
    className: pascal(id),
    storeClassName: `${pascal(id)}Store`,
    selector: `app-${kebab(id)}`,
    routePath: kebab(id),
    componentFile: `${kebab(id)}.ts`,
    templateFile: `${kebab(id)}.html`,
    styleFile: `${kebab(id)}.css`,
    storeFile: `${kebab(id)}.store.ts`,
    specFile: `${kebab(id)}.spec.ts`,
    contractsFile: `${kebab(id)}.contracts.ts`,
    apiFile: `${kebab(id)}.api.ts`,
    apiClassName: `${pascal(id)}Api`,
    importsFile: `${kebab(id)}.imports.ts`,
    importsConst: `${words(id).join('_').toUpperCase()}_IMPORTS`,
  }),

  // Typed shapes the page depends on. Derived from commands.md / readmodels.md,
  // so they live in the GENERATED contracts file, never hand-written.
  payload: (commandId) => `${pascal(commandId)}Payload`,
  view: (readModelId) => `${pascal(readModelId)}View`,

  // Store members
  triggerMethod: (commandId) => camel(commandId),
  viewSignal: (readModelId) => camel(readModelId),
  loadMethod: (readModelId) => `load${pascal(readModelId)}`,
  // Api members — mirror the generated Spring controllers one-for-one
  postMethod: (commandId) => camel(commandId),
  getMethod: (readModelId) => `get${pascal(readModelId)}`,

  field: (label) => camel(label),
};

export default naming;
