/**
 * Types for the pi-auto extension.
 */

/** Auto mode configuration. */
export type AutoConfig = {
  /** Paths to deny read access (glob patterns). */
  readonly denyRead: readonly string[];
  /** Paths to allow write access (glob patterns). */
  readonly allowWrite: readonly string[];
  /** Paths to deny write access (glob patterns). Takes precedence over allowWrite. */
  readonly denyWrite: readonly string[];
  /** Domains allowed for network access. */
  readonly allowedDomains: readonly string[];
  /** Tool permission specs to auto-approve. */
  readonly allowTools: readonly string[];
  /** Tool permission specs to auto-deny. Takes precedence over allowTools. */
  readonly denyTools: readonly string[];
};

/** Default auto config (all empty — no automatic approvals). */
export const DEFAULT_AUTO_CONFIG: AutoConfig = {
  denyRead: [],
  allowWrite: [],
  denyWrite: [],
  allowedDomains: [],
  allowTools: [],
  denyTools: [],
} as const satisfies AutoConfig;
