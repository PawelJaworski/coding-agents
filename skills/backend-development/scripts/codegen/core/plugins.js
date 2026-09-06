// Plugin interfaces — the extension points of the codegen system
// These are the stable contracts that plugins implement

/**
 * Parses markdown model files into structured sections.
 * Each parser owns a set of model files (commands.md, events.md, etc.)
 * @typedef {Object} ModelParserPlugin
 * @property {string} id - Unique plugin identifier
 * @property {string[]} modelFiles - Model files this plugin reads
 * @property {(files: Record<string, string>) => import('./types.js').ParsedSection[]} parse - Parse raw markdown into structured sections
 * @property {(text: string) => import('./types.js').Definition[]} [parseDefinitions] - Optional: contribute business definitions
 */

/**
 * Transforms a parsed model into generated Java files.
 * @typedef {Object} EmitterPlugin
 * @property {string} id - Unique plugin identifier
 * @property {string[]} provides - Construct types this plugin provides
 * @property {string[]} requires - Construct types this plugin requires
 * @property {(model: import('./types.js').Model, context: EmitContext) => import('./types.js').File[]} emit - Emit files for the given model
 * @property {StepPlugin} [step] - Optional: contribute to the step workflow
 */

/**
 * Context passed to emitters with shared utilities
 * @typedef {Object} EmitContext
 * @property {string} basePackage - Base package from config
 * @property {import('./types.js').NamingConventions} naming - Naming conventions
 * @property {Map<string, import('./types.js').Event>} eventsById - All events by ID
 * @property {Map<string, import('./types.js').Command>} commandsById - All commands by ID
 * @property {Map<string, import('./types.js').ReadModel>} readModelsById - All read models by ID
 * @property {(imports: string[]) => string} importBlock - Utility: unique imports
 * @property {(fields: import('./types.js').Field[]) => string} components - Field components for records
 * @property {(c: CollaboratorSpec) => import('./types.js').Collaborator} collaborator - Create collaborator
 * @property {(collaborators: import('./types.js').Collaborator[]) => string} fieldDeclarations - Field declarations
 * @property {(collaborators: import('./types.js').Collaborator[]) => string} constructorArgs - Constructor args
 * @property {(collaborators: import('./types.js').Collaborator[]) => string[]} collaboratorImports - Imports
 * @property {(collaborators: import('./types.js').Collaborator[]) => import('./types.js').File[]} collaboratorScaffolds - Scaffolds
 * @property {(field: import('./types.js').Field, opts: ResolveArgOptions) => ResolveResult|null} resolveArg - Resolve argument
 */

/**
 * @typedef {Object} CollaboratorSpec
 * @property {string} fieldName
 * @property {string} className
 * @property {string} testInstantiation
 * @property {string[]} [imports]
 * @property {() => import('./types.js').File} [scaffold]
 */

/**
 * @typedef {Object} ResolveArgOptions
 * @property {import('./types.js').Field[]} sourceFields
 * @property {string} sourceExpr
 * @property {import('./types.js').Collaborator & {args?: string}} delegate
 * @property {(field: import('./types.js').Field) => string} [fallback]
 */

/**
 * @typedef {Object} ResolveResult
 * @property {string} expr
 * @property {string[]} imports
 * @property {boolean} [delegated]
 */

/**
 * Step plugin — defines a workflow step
 * @typedef {Object} StepPlugin
 * @property {string} id - Step ID (e.g., 'GENERATE_COMMANDS')
 * @property {string} category - Patch category this step consumes
 * @property {string[]} after - Step IDs that must complete before this one
 * @property {(patch: PatchDocument) => PatchEntry[]} detect - Detect pending items
 * @property {(item: PatchEntry, index: number, total: number) => string} render - Render prompt
 * @property {(item: PatchEntry) => void} [apply] - Apply auto:true entry
 */

/**
 * @typedef {Object} PatchDocument
 * @property {PatchEntry[]} entries
 * @property {{create: number, add: number, update: number, needsAgent: number}} summary
 */

/**
 * @typedef {Object} PatchEntry
 * @property {'CREATE'|'ADD'|'UPDATE'} op
 * @property {string} path
 * @property {string[]} [members]
 * @property {boolean} auto
 * @property {string[]} [hints]
 * @property {'scenario'|'business-rule'} [kind]
 * @property {string} [name]
 * @property {string} [source]
 * @property {string} [spec]
 */

/**
 * Scanner plugin — scans model + filesystem for pending work.
 * Unlike emitters (which generate files), scanners produce patch entries.
 * @typedef {Object} ScannerPlugin
 * @property {string} id
 * @property {string} category - Patch category this scanner produces (e.g., 'gwt')
 * @property {string[]} requires - Plugin IDs this scanner needs data from
 * @property {(model: import('./types.js').Model, context: ScannerContext) => PatchEntry[]} scan
 */

/**
 * Context passed to scanners
 * @typedef {Object} ScannerContext
 * @property {string} projectRoot
 * @property {string} modelDir
 * @property {string} groovyTestRoot
 * @property {string} basePackage
 * @property {import('./types.js').Command[]} commands
 * @property {import('./types.js').ReadModel[]} readModels
 * @property {(path: string) => string} readFile - Read a file relative to projectRoot
 * @property {(pattern: string) => string[]} glob - Find files matching a glob pattern
 */

/**
 * Naming plugin — allows custom naming conventions
 * @typedef {Object} NamingPlugin
 * @property {string} id
 * @property {(base: import('./types.js').NamingConventions) => import('./types.js').NamingConventions} extend
 */

/**
 * Complete plugin manifest
 * @typedef {Object} PluginManifest
 * @property {string} id
 * @property {string} version
 * @property {ModelParserPlugin} [modelParser]
 * @property {EmitterPlugin} [emitter]
 * @property {ScannerPlugin} [scanner]
 * @property {NamingPlugin} [naming]
 */

/**
 * Registry entry with resolved dependencies
 * @typedef {Object} RegisteredPlugin
 * @property {PluginManifest} manifest
 * @property {ModelParserPlugin} [modelParser]
 * @property {EmitterPlugin & {step?: StepPlugin}} [emitter]
 * @property {ScannerPlugin & {step?: StepPlugin}} [scanner]
 * @property {NamingPlugin} [naming]
 * @property {string[]} dependencies
 * @property {string[]} dependents
 */

// No runtime exports needed — this is just typedefs