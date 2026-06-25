/**
 * AI Harness — Public API
 *
 * This module re-exports the core building blocks for programmatic use.
 * Import from this entry point instead of reaching into internal modules.
 */

export { AgentHarness } from './agents/agent-harness.js';
export { createLocalLlmClient } from './llm/client.js';
export type { LocalLlmClient } from './llm/client.js';
export { tools } from './tools/index.js';
export * from './types/index.js';
export * from './errors/index.js';
