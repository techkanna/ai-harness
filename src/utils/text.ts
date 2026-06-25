/**
 * Truncates text to fit within byte and line limits.
 * Appends a truncation notice if the text was shortened.
 *
 * @param text - The text to truncate.
 * @param maxBytes - Maximum byte length (UTF-8).
 * @param maxLines - Maximum number of lines.
 * @returns The truncated text, with a notice if truncation occurred.
 */
export function truncateText(text: string, maxBytes: number, maxLines: number): string {
  const lines = text.split(/\r?\n/);
  let truncated = lines.length > maxLines ? lines.slice(0, maxLines).join('\n') : text;
  if (Buffer.byteLength(truncated, 'utf8') > maxBytes) {
    truncated = Buffer.from(truncated, 'utf8').slice(0, maxBytes).toString('utf8');
  }
  if (truncated.length < text.length) {
    truncated += '\n...output truncated...';
  }
  return truncated;
}

/**
 * Truncates a string to a maximum character length, appending an ellipsis if shortened.
 *
 * @param text - The string to truncate.
 * @param maxLength - Maximum character length.
 * @returns The truncated string.
 */
export function truncateString(text: string, maxLength: number): string {
  return text.length > maxLength ? text.slice(0, maxLength) + '…' : text;
}
