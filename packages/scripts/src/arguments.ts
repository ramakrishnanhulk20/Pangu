/**
 * Command line flags for the devnet scripts.
 *
 * A flag carries a value, `--mode list` or `--mode=list`, unless the command
 * names it as a switch, such as `--no-end`, which takes none. A name the script
 * does not know is refused rather than ignored, so a typo in a flag that spends
 * devnet SOL stops the run instead of quietly changing nothing.
 */

export class ArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArgumentError";
  }
}

export type Flags = ReadonlyMap<string, string>;

/**
 * Reads the flags out of an argument list.
 *
 * `switches` are names that take no value; a switch that is present reads as
 * "true". Throws ArgumentError for a name that is in neither list, for a
 * repeated flag, for a flag with no value, for a switch given one, and for a
 * bare word that is not attached to a flag.
 */
export function readFlags(
  argv: readonly string[],
  known: readonly string[],
  switches: readonly string[] = []
): Flags {
  const allowed = new Set([...known, ...switches]);
  const isSwitch = new Set(switches);
  const flags = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (!token.startsWith("--")) {
      throw new ArgumentError(`"${token}" is not a flag. Flags look like --name value.`);
    }
    const equals = token.indexOf("=");
    const name = equals === -1 ? token.slice(2) : token.slice(2, equals);
    if (!allowed.has(name)) {
      throw new ArgumentError(
        `--${name} is not a flag this command takes. It takes: ${[...allowed].map((each) => `--${each}`).join(", ")}`
      );
    }
    if (flags.has(name)) {
      throw new ArgumentError(`--${name} was given twice, and the two would disagree`);
    }
    if (isSwitch.has(name)) {
      if (equals !== -1) {
        throw new ArgumentError(`--${name} takes no value`);
      }
      flags.set(name, "true");
      continue;
    }
    let value: string;
    if (equals === -1) {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new ArgumentError(`--${name} needs a value`);
      }
      value = next;
      index += 1;
    } else {
      value = token.slice(equals + 1);
    }
    if (value.length === 0) {
      throw new ArgumentError(`--${name} needs a value`);
    }
    flags.set(name, value);
  }

  return flags;
}

/** A flag's text, or the fallback when it was not given. */
export function text(flags: Flags, name: string, fallback: string): string {
  return flags.get(name) ?? fallback;
}

/** A flag that must be given. Throws ArgumentError when it is missing. */
export function requiredText(flags: Flags, name: string, why: string): string {
  const value = flags.get(name);
  if (value === undefined) {
    throw new ArgumentError(`--${name} is needed: ${why}`);
  }
  return value;
}

/** One of a fixed set of words. Throws ArgumentError for anything else. */
export function choice<T extends string>(
  flags: Flags,
  name: string,
  options: readonly T[],
  fallback: T
): T {
  const value = flags.get(name);
  if (value === undefined) {
    return fallback;
  }
  if (!(options as readonly string[]).includes(value)) {
    throw new ArgumentError(
      `--${name} must be one of ${options.join(", ")}, got "${value}"`
    );
  }
  return value as T;
}

/** A whole number inside a range. Throws ArgumentError outside it. */
export function wholeNumber(
  flags: Flags,
  name: string,
  low: number,
  high: number,
  fallback: number
): number {
  const value = flags.get(name);
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new ArgumentError(`--${name} must be a whole number, got "${value}"`);
  }
  if (parsed < low || parsed > high) {
    throw new ArgumentError(
      `--${name} must be between ${low} and ${high}, got ${parsed}`
    );
  }
  return parsed;
}

/** An amount with decimals, above zero and inside a range. */
export function amount(
  flags: Flags,
  name: string,
  low: number,
  high: number,
  fallback: number
): number {
  const value = flags.get(name);
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new ArgumentError(`--${name} must be a number, got "${value}"`);
  }
  if (parsed < low || parsed > high) {
    throw new ArgumentError(
      `--${name} must be between ${low} and ${high}, got ${parsed}`
    );
  }
  return parsed;
}
