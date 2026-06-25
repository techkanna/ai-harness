import { ValidationError } from '../errors/errors.js';

/**
 * Validates that a value is a non-null string.
 * Coerces non-string truthy values to strings via `String()`.
 *
 * @param value - The value to validate.
 * @param name - The parameter name (used in error messages).
 * @returns The validated string value.
 * @throws {ValidationError} If the value is null or undefined.
 */
export function requireString(value: unknown, name: string): string {
  if (typeof value === 'string') return value;
  if (value == null) throw new ValidationError(`Missing required parameter: ${name}`);
  return String(value);
}
