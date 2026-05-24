import { describe, expect, it } from 'vitest';

import { evaluateBashNetworkPolicy } from './network-policy.service.pure.ts';

describe('evaluateBashNetworkPolicy', () => {
  it('allows commands without urls', () => {
    expect(evaluateBashNetworkPolicy('echo hi', [])).toEqual({ kind: 'allow-in-sandbox' });
  });

  it('allows GET to disallowed domains', () => {
    expect(evaluateBashNetworkPolicy('curl https://example.com', [])).toEqual({
      kind: 'allow-unsandboxed',
      reason: 'network read method GET to external domain example.com',
    });
  });

  it('requires approval for POST to disallowed domains', () => {
    expect(evaluateBashNetworkPolicy("curl -X POST https://example.com -d 'x=1'", [])).toEqual({
      kind: 'requires-approval',
      reason: 'network write method POST to disallowed domain example.com',
    });
  });

  it('allows POST to allowed domains', () => {
    expect(
      evaluateBashNetworkPolicy("curl -X POST https://api.github.com/graphql -d 'x=1'", [
        'github.com',
        '*.github.com',
      ]),
    ).toEqual({ kind: 'allow-in-sandbox' });
  });

  it('treats curl -d as POST', () => {
    expect(evaluateBashNetworkPolicy("curl https://example.com -d 'x=1'", [])).toEqual({
      kind: 'requires-approval',
      reason: 'network write method POST to disallowed domain example.com',
    });
  });
});
