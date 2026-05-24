/**
 * Permission spec formatting and matching for tool calls.
 *
 * A permission spec is a canonical string representation of a tool call:
 * `toolName(arg1=value1, arg2=value2)`
 *
 * Arguments are sorted alphabetically, with default values filled in.
 * Glob patterns can be used in path-like argument values.
 */

// ---------------------------------------------------------------------------
// Tool parameter schemas — default values for each built-in tool
// ---------------------------------------------------------------------------

type ParamSchema = {
  readonly order: number;
  readonly default?: string | number;
};

type ToolSchema = {
  readonly params: Record<string, ParamSchema>;
};

/**
 * Schemas for built-in pi tools.
 * Each param has an order for alphabetical sorting and an optional default.
 */
const BUILTIN_TOOL_SCHEMAS: Record<string, ToolSchema> = {
  read: {
    params: {
      path: { order: 0 },
      offset: { order: 1, default: 0 },
      limit: { order: 2, default: 2000 },
    },
  },
  write: {
    params: {
      path: { order: 0 },
      content: { order: 1 },
    },
  },
  edit: {
    params: {
      path: { order: 0 },
    },
  },
  bash: {
    params: {
      command: { order: 0 },
      timeout: { order: 1, default: 0 },
    },
  },
};

// ---------------------------------------------------------------------------
// Format tool call as permission spec
// ---------------------------------------------------------------------------

/**
 * Format a tool call as a canonical permission spec string.
 * Arguments are sorted alphabetically, defaults filled in.
 */
export const formatPermissionSpec = (toolName: string, params: Record<string, unknown>): string => {
  const schema = BUILTIN_TOOL_SCHEMAS[toolName];

  if (schema === undefined) {
    // Unknown tool — serialize all args sorted by name
    const args = Object.entries(params)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${formatValue(value)}`);

    return `${toolName}(${args.join(', ')})`;
  }

  // Fill defaults for known tool
  const filled: Record<string, string> = {};

  for (const [paramName, paramSchema] of Object.entries(schema.params)) {
    const value = params[paramName];

    if (value !== undefined) {
      filled[paramName] = formatValue(value);
    } else if (paramSchema.default !== undefined) {
      filled[paramName] = formatValue(paramSchema.default);
    }
    // If no value and no default, skip the param
  }

  const args = Object.entries(filled)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`);

  return `${toolName}(${args.join(', ')})`;
};

export const formatValue = (value: unknown): string => {
  if (typeof value === 'string') {
    // Escape single quotes in string values
    const escaped = value.replaceAll("'", "\\'");
    return `'${escaped}'`;
  }

  if (typeof value === 'number') {
    return String(value);
  }

  if (typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    const items = value.map((v) => formatValue(v)).join(', ');
    return `[${items}]`;
  }

  if (typeof value === 'object' && value !== null) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${formatValue(v)}`);
    return `{${entries.join(', ')}}`;
  }

  return String(value);
};

// ---------------------------------------------------------------------------
// Parse permission spec string
// ---------------------------------------------------------------------------

type ParsedPermissionSpec = {
  readonly toolName: string;
  readonly args: Record<string, string>;
};

/**
 * Parse a permission spec string back into tool name and arguments.
 * Handles `toolName(arg1='value1', arg2='value2')` format.
 */
export const parsePermissionSpec = (spec: string): ParsedPermissionSpec | null => {
  const match = /^([\w*-]+)\((.*)\)$/.exec(spec.trim());

  if (match === null || match[1] === undefined || match[2] === undefined) {
    return null;
  }

  const toolName = match[1];
  const argsStr = match[2];

  if (argsStr.trim() === '') {
    return { toolName, args: {} };
  }

  const args: Record<string, string> = {};
  const tokens = tokenizeArgs(argsStr);

  for (const token of tokens) {
    const eqIdx = token.indexOf('=');

    if (eqIdx === -1) continue;

    const key = token.slice(0, eqIdx).trim();
    let value = token.slice(eqIdx + 1).trim();

    // Strip surrounding quotes
    if (
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"'))
    ) {
      value = value.slice(1, -1).replaceAll("\\'", "'").replaceAll('\\"', '"');
    }

    args[key] = value;
  }

  return { toolName, args };
};

/**
 * Tokenize argument string, respecting quoted values and nested structures.
 */
// Not exported — used internally by parsePermissionSpec
export const tokenizeArgs = (str: string): string[] => {
  const tokens: string[] = [];
  let current = '';
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (const ch of str) {
    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      current += ch;
      continue;
    }

    if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      current += ch;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote) {
      if (ch === '{' || ch === '[') {
        depth++;
      } else if (ch === '}') {
        depth = Math.max(0, depth - 1);
      } else if (ch === ']') {
        depth = Math.max(0, depth - 1);
      } else if (ch === ',' && depth === 0) {
        if (current.trim() !== '') {
          tokens.push(current.trim());
        }
        current = '';
        continue;
      }
    }

    current += ch;
  }

  if (current.trim() !== '') {
    tokens.push(current.trim());
  }

  return tokens;
};

// ---------------------------------------------------------------------------
// Glob pattern matching for permission specs
// ---------------------------------------------------------------------------

/**
 * Check if a permission spec string matches a pattern spec.
 * Pattern specs can use glob patterns in path-like argument values.
 *
 * Example:
 *   matchesPatternSpec("read(path='/tmp/test.md')", "read(path='/tmp/*.md')") → true
 */
export const matchesPermissionPattern = (spec: string, pattern: string): boolean => {
  const parsedSpec = parsePermissionSpec(spec);
  const parsedPattern = parsePermissionSpec(pattern);

  if (parsedSpec === null || parsedPattern === null) return false;
  if (parsedPattern.toolName !== '*' && parsedSpec.toolName !== parsedPattern.toolName)
    return false;

  // All pattern args must match spec args
  for (const [key, patternValue] of Object.entries(parsedPattern.args)) {
    const specValue = parsedSpec.args[key];

    if (specValue === undefined) return false;

    if (!matchesArg(specValue, patternValue)) return false;
  }

  return true;
};

/**
 * Match a single argument value against a pattern.
 * Uses glob matching for path-like values, and simple wildcard
 * substring matching for command-like values.
 */
const matchesArg = (value: string, pattern: string): boolean => {
  // If the pattern contains /, treat it as a path pattern (glob match)
  if (pattern.includes('/')) {
    return matchesGlob(value, pattern);
  }

  // Otherwise use simple wildcard matching (* matches any substring)
  return matchesSimpleWildcard(value, pattern);
};

const matchesSimpleWildcard = (value: string, pattern: string): boolean => {
  if (!pattern.includes('*')) return value === pattern;

  const parts = pattern.split('*');

  // Empty pattern or just * matches everything
  if (parts.length === 1 && parts[0] === '') return true;

  let idx = 0;

  for (let i = 0; i < parts.length; i++) {
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const part = parts[i]!;

    if (part === '') continue;

    const foundIdx = value.indexOf(part, idx);

    if (foundIdx === -1) return false;

    if (i === 0 && foundIdx !== 0) return false;

    idx = foundIdx + part.length;
  }

  // Last part must match at end unless last pattern part is empty (trailing *)
  if (pattern.endsWith('*')) return true;

  return idx === value.length;
};

/**
 * Simple glob matching for path patterns.
 * Supports `*` (any chars except `/`), `**` (any chars including `/`), and `?` (single char).
 */
export const matchesGlob = (value: string, pattern: string): boolean => {
  // If pattern doesn't contain glob characters, do exact match
  if (!pattern.includes('*') && !pattern.includes('?')) {
    return value === pattern;
  }

  const regex = globToRegex(pattern);
  return regex.test(value);
};

export const globToRegex = (pattern: string): RegExp => {
  let regexStr = '^';

  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];

    if (ch === undefined) {
      i++;
      continue;
    }

    if (ch === '*' && pattern[i + 1] === '*') {
      // ** matches any characters including /
      regexStr += '.*';
      i += 2;
      // Skip optional trailing /
      if (pattern[i] === '/') i++;
      continue;
    }

    if (ch === '*') {
      // * matches any characters except /
      regexStr += '[^/]*';
      i++;
      continue;
    }

    if (ch === '?') {
      // ? matches any single character except /
      regexStr += '[^/]';
      i++;
      continue;
    }

    // Escape regex special characters
    if (/[.+^${}()|[\]\\]/.test(ch)) {
      regexStr += '\\' + ch;
    } else {
      regexStr += ch;
    }
    i++;
  }

  regexStr += '$';

  return new RegExp(regexStr);
};

// ---------------------------------------------------------------------------
// Tool name matching
// ---------------------------------------------------------------------------

/**
 * Check if a tool name matches a permission spec pattern's tool name.
 * Handles wildcard `*` for any tool.
 */
export const matchesToolName = (toolName: string, pattern: string): boolean => {
  const parsed = parsePermissionSpec(pattern);

  if (parsed === null) return false;

  if (parsed.toolName === '*') return true;

  return parsed.toolName === toolName;
};

// Re-export simple wildcard for testing
export { matchesSimpleWildcard as _matchesSimpleWildcard };
