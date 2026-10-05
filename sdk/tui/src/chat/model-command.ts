/**
 * True for `/model <anything>`, which the server handles as a model switch.
 * Must match how the server reads it (`parseModelCommand` in `@reflex/shared`).
 */
export function isModelSwitchCommand(text: string): boolean {
  const words = text.trim().split(/\s+/);
  return words.length > 1 && words[0]!.toLowerCase() === '/model';
}
