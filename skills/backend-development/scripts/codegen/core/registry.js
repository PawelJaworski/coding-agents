// Plugin registry — discovers, validates, and orders plugins

/**
 * @typedef {import('./plugins.js').PluginManifest} PluginManifest
 * @typedef {import('./plugins.js').RegisteredPlugin} RegisteredPlugin
 * @typedef {import('./plugins.js').ModelParserPlugin} ModelParserPlugin
 * @typedef {import('./plugins.js').EmitterPlugin} EmitterPlugin
 * @typedef {import('./plugins.js').NamingPlugin} NamingPlugin
 * @typedef {import('./plugins.js').StepPlugin} StepPlugin
 */

export class PluginRegistry {
  constructor() {
    /** @type {Map<string, RegisteredPlugin>} */
    this.plugins = new Map();
    /** @type {ModelParserPlugin[]} */
    this.modelParsers = [];
    /** @type {EmitterPlugin[]} */
    this.emitters = [];
    /** @type {ScannerPlugin[]} */
    this.scanners = [];
    /** @type {StepPlugin[]} */
    this.steps = [];
    /** @type {NamingPlugin[]} */
    this.naming = [];
  }

  /** Register a plugin manifest */
  register(manifest) {
    if (this.plugins.has(manifest.id)) {
      throw new Error(`Plugin "${manifest.id}" already registered`);
    }

    // Support two structures:
    // 1. manifest.emitter = { emit, step, ... } (explicit emitter)
    // 2. manifest.emit = (...) (manifest IS the emitter)
    const emitter = manifest.emitter || (manifest.emit ? manifest : null);
    const scanner = manifest.scanner || (manifest.scan ? manifest : null);

    /** @type {RegisteredPlugin} */
    const registered = {
      manifest,
      modelParser: manifest.modelParser,
      emitter: emitter,
      scanner: scanner,
      naming: manifest.naming,
      dependencies: [],
      dependents: []
    };

    // Collect dependencies from emitter or scanner
    const deps = (emitter && emitter.requires) || (scanner && scanner.requires) || [];
    registered.dependencies = [...deps];

    this.plugins.set(manifest.id, registered);

    // Register components
    if (manifest.modelParser) this.modelParsers.push(manifest.modelParser);
    if (emitter) {
      this.emitters.push(emitter);
      if (emitter.step) this.steps.push(emitter.step);
    }
    if (scanner) {
      this.scanners.push(scanner);
      if (scanner.step) this.steps.push(scanner.step);
    }
    if (manifest.naming) this.naming.push(manifest.naming);
  }

  /** Register multiple plugins at once */
  registerAll(manifests) {
    for (const m of manifests) {
      this.register(m);
    }
  }

  /** Get topologically sorted emitters */
  getSortedEmitters() {
    this.resolveDependencies();
    const result = this.topologicalSort(this.emitters, e => e.id, e => e.requires);
    return result;
  }

  /** Get topologically sorted steps */
  getSortedSteps() {
    this.resolveDependencies();
    const stepDeps = new Map();
    for (const step of this.steps) {
      stepDeps.set(step.id, [...step.after]);
    }
    return this.topologicalSort(this.steps, s => s.id, s => stepDeps.get(s.id) ?? []);
  }

  /** Get all model parsers */
  getModelParsers() {
    return this.modelParsers;
  }

  /** Get composed naming conventions */
  getNaming(base) {
    let naming = base;
    for (const n of this.naming) {
      naming = n.extend(naming);
    }
    return naming;
  }

  /** Get plugin by ID */
  get(id) {
    return this.plugins.get(id);
  }

  /** All registered plugin IDs */
  get ids() {
    return Array.from(this.plugins.keys());
  }

  resolveDependencies() {
    // Build dependents list
    for (const [id, plugin] of this.plugins) {
      for (const dep of plugin.dependencies) {
        const depPlugin = this.plugins.get(dep);
        if (!depPlugin) {
          throw new Error(`Plugin "${id}" requires unknown plugin "${dep}"`);
        }
        depPlugin.dependents.push(id);
      }
    }

    // Detect cycles
    const visited = new Set();
    const stack = new Set();

    const visit = (id) => {
      if (stack.has(id)) {
        throw new Error(`Circular dependency detected: ${[...stack, id].join(' -> ')}`);
      }
      if (visited.has(id)) return;
      stack.add(id);
      const plugin = this.plugins.get(id);
      if (plugin) {
        for (const dep of plugin.dependencies) visit(dep);
      }
      stack.delete(id);
      visited.add(id);
    };

    for (const id of this.plugins.keys()) visit(id);
  }

  topologicalSort(items, getId, getDeps) {
    const itemMap = new Map(items.map(i => [getId(i), i]));
    const result = [];
    const visited = new Set();
    const visiting = new Set();

    const visit = (id) => {
      if (visiting.has(id)) {
        throw new Error(`Cycle detected in topological sort: ${id}`);
      }
      if (visited.has(id)) return;
      visiting.add(id);
      const item = itemMap.get(id);
      if (item) {
        for (const dep of getDeps(item)) visit(dep);
        result.push(item);
      }
      visiting.delete(id);
      visited.add(id);
    };

    for (const item of items) visit(getId(item));
    return result;
  }
}

/** Create a registry with built-in plugins */
export function createRegistry() {
  const registry = new PluginRegistry();
  return registry;
}