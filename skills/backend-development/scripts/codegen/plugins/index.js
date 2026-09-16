// Built-in plugins registry
// This is where all core plugins are registered

import { PluginRegistry } from '../core/registry.js';
import { DomainPlugin } from './DomainPlugin.js';
import { EventPlugin } from './EventPlugin.js';
import { AggregatePlugin } from './AggregatePlugin.js';
import { CommandPlugin } from './CommandPlugin.js';
import { ReadModelPlugin } from './ReadModelPlugin.js';
import { TestDataPlugin } from './TestDataPlugin.js';
import { GWTPlugin } from './GWTPlugin.js';
// import { SerdePlugin } from './SerdePlugin.js';

/** Create a registry with all built-in plugins */
export function createBuiltinRegistry() {
  const registry = new PluginRegistry();
  registry.registerAll([
    DomainPlugin,
    EventPlugin,
    AggregatePlugin,
    CommandPlugin,
    ReadModelPlugin,
    TestDataPlugin,
    GWTPlugin
    // SerdePlugin
  ]);
  return registry;
}