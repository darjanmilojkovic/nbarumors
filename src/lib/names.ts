const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

/**
 * The name a headline would use on second reference: Dončić, Antetokounmpo,
 * Porter Jr.
 *
 * The suffix stays attached. It is part of how these players are named, and
 * dropping it would collapse Michael Porter Jr. and Kevin Porter onto one
 * label. Taking the last word alone once turned 68 players into "Jr." and
 * "III", which is why the tail is checked rather than assumed.
 *
 * Shared rather than copied: the card and the masthead now both shorten names,
 * and two implementations of this would drift the first time a suffix is
 * added.
 */
export function surname(name: string): string {
  const parts = name.trim().split(/\s+/);
  const tail = parts[parts.length - 1];
  return parts.length > 2 && SUFFIXES.has(tail.toLowerCase().replace(/\.$/, ""))
    ? `${parts[parts.length - 2]} ${tail}`
    : tail;
}
