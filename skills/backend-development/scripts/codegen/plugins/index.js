// Built-in plugins registry
// This is where all core plugins are registered

import { PluginRegistry } from '../core/registry.js';
import { DomainPlugin } from './DomainPlugin.js';
import { EventPlugin } from './EventPlugin.js';
import { CommandPlugin } from './CommandPlugin.js';
import { ReadModelPlugin } from './ReadModelPlugin.js';
import { GWTPlugin } from './GWTPlugin.js';
// import { SerdePlugin } from './SerdePlugin.js';

/** Create a registry with all built-in plugins */
export function createBuiltinRegistry() {
  const registry = new PluginRegistry();
  registry.registerAll([
    DomainPlugin,
    EventPlugin,
    CommandPlugin,
    ReadModelPlugin,
    GWTPlugin
    // SerdePlugin
  ]);
  return registry;
}