// ─── Tool Parameter Schema ─────────────────────────────────────────────────

/** Describes a single property in a tool's parameter schema. */
export interface ToolParameterProperty {
  type: string;
  description: string;
  enum?: string[];
  default?: unknown;
}

/** JSON Schema-compatible parameter definition for a tool. */
export interface ToolParameters {
  type: 'object';
  properties: Record<string, ToolParameterProperty>;
  required: string[];
}

// ─── Tool Definition ────────────────────────────────────────────────────────

/**
 * A tool that the agent can invoke.
 *
 * `parameters` declares the JSON Schema for the tool's arguments.
 * `func` receives the **parsed** arguments object (the harness handles
 * JSON.parse for you — no manual parsing needed inside tools).
 */
export interface Tool {
  name: string;
  description: string;
  parameters: ToolParameters;
  func: (args: Record<string, unknown>) => Promise<string>;
}
