const extractUrls = (command: string): URL[] => {
  const matches = command.match(/https?:\/\/[^\s'"`]+/g) ?? [];
  const urls: URL[] = [];

  for (const match of matches) {
    try {
      urls.push(new URL(match));
    } catch {
      continue;
    }
  }

  return urls;
};

const matchesAllowedDomain = (hostname: string, pattern: string): boolean => {
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(2);
    return hostname === suffix || hostname.endsWith(`.${suffix}`);
  }

  return hostname === pattern;
};

const detectHttpMethod = (command: string): string => {
  const explicitMethodMatch =
    /(?:^|\s)(?:-X|--request)(?:\s+|=)(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/i.exec(command);

  if (explicitMethodMatch?.[1] !== undefined) {
    return explicitMethodMatch[1].toUpperCase();
  }

  if (/(?:^|\s)(?:-I|--head)\b/i.test(command)) {
    return 'HEAD';
  }

  if (
    /(?:^|\s)(?:-d|--data|--data-raw|--data-binary|-F|--form|-T|--upload-file|--post-data|--post-file)\b/i.test(
      command,
    )
  ) {
    return 'POST';
  }

  return 'GET';
};

export type BashNetworkPolicyDecision =
  | { readonly kind: 'allow-in-sandbox' }
  | { readonly kind: 'allow-unsandboxed'; readonly reason: string }
  | { readonly kind: 'requires-approval'; readonly reason: string };

export const evaluateBashNetworkPolicy = (
  command: string,
  allowedDomains: readonly string[],
): BashNetworkPolicyDecision => {
  const urls = extractUrls(command);

  if (urls.length === 0) {
    return { kind: 'allow-in-sandbox' };
  }

  const method = detectHttpMethod(command);
  const disallowedUrl = urls.find(
    (url) => !allowedDomains.some((pattern) => matchesAllowedDomain(url.hostname, pattern)),
  );

  if (disallowedUrl === undefined) {
    return { kind: 'allow-in-sandbox' };
  }

  if (method === 'GET' || method === 'HEAD') {
    return {
      kind: 'allow-unsandboxed',
      reason: `network read method ${method} to external domain ${disallowedUrl.hostname}`,
    };
  }

  return {
    kind: 'requires-approval',
    reason: `network write method ${method} to disallowed domain ${disallowedUrl.hostname}`,
  };
};
