import type { AutoConfig } from './types.pure.ts';

import {
  formatPermissionSpec,
  matchesPermissionPattern,
  matchesToolName,
} from './permission-spec.service.pure.ts';

// ---------------------------------------------------------------------------
// Tool permission check result
// ---------------------------------------------------------------------------

export type ToolPermissionResult =
  | { readonly kind: 'auto-approve'; readonly matchedBy: string }
  | { readonly kind: 'auto-deny'; readonly matchedBy: string }
  | { readonly kind: 'needs-sandbox' };

// ---------------------------------------------------------------------------
// Check tool against allowTools/denyTools
// ---------------------------------------------------------------------------

/**
 * Check whether a tool call should be auto-approved, auto-denied, or needs sandboxing.
 *
 * denyTools takes precedence over allowTools.
 */
export const checkToolPermission = (
  toolName: string,
  params: Record<string, unknown>,
  config: AutoConfig,
): ToolPermissionResult => {
  const spec = formatPermissionSpec(toolName, params);

  // 1. Check denyTools first (takes precedence)
  for (const pattern of config.denyTools) {
    if (matchesToolName(toolName, pattern) && matchesPermissionPattern(spec, pattern)) {
      return { kind: 'auto-deny', matchedBy: pattern };
    }
  }

  // 2. Check allowTools
  for (const pattern of config.allowTools) {
    if (matchesToolName(toolName, pattern) && matchesPermissionPattern(spec, pattern)) {
      return { kind: 'auto-approve', matchedBy: pattern };
    }
  }

  // 3. Default: needs sandbox
  return { kind: 'needs-sandbox' };
};
