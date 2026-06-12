import { describe, expect, it } from 'vitest';

import { buildSrtConfig } from './sandbox-config.service.pure.ts';
import { DEFAULT_AUTO_CONFIG, type AutoConfig } from './types.pure.ts';

describe('buildSrtConfig', () => {
  it('builds config with sensible defaults', () => {
    const config = buildSrtConfig('/home/user/project', DEFAULT_AUTO_CONFIG);

    // Filesystem
    expect(config.filesystem.denyRead).toBeDefined();
    expect(config.filesystem.denyRead.length).toBeGreaterThan(0);
    expect(config.filesystem.denyRead).toContain('~/.ssh');

    expect(config.filesystem.allowWrite).toBeDefined();
    expect(config.filesystem.allowWrite).toContain('.');
    expect(config.filesystem.allowWrite).toContain('/tmp');
    expect(config.filesystem.allowWrite).toContain('~/.pi/agent');

    expect(config.filesystem.denyWrite).toBeDefined();
    expect(config.filesystem.denyWrite).toContain('.env');

    // Network
    expect(config.network.allowedDomains).toBeDefined();
    expect(config.network.allowedDomains.length).toBeGreaterThan(0);
    expect(config.network.allowedDomains).toContain('github.com');
    expect(config.network.deniedDomains).toBeDefined();
    expect(config.network.deniedDomains).toEqual([]);
  });

  it('merges user denyRead patterns', () => {
    const userConfig: AutoConfig = {
      ...DEFAULT_AUTO_CONFIG,
      denyRead: ['/etc/passwd', '/var/log/**'],
    };

    const config = buildSrtConfig('/home/user/project', userConfig);

    expect(config.filesystem.denyRead).toContain('/etc/passwd');
    expect(config.filesystem.denyRead).toContain('/var/log/**');
    // Defaults still present
    expect(config.filesystem.denyRead).toContain('~/.ssh');
  });

  it('merges user allowWrite patterns', () => {
    const userConfig: AutoConfig = {
      ...DEFAULT_AUTO_CONFIG,
      allowWrite: ['~/.cache', '~/.local/share'],
    };

    const config = buildSrtConfig('/home/user/project', userConfig);

    expect(config.filesystem.allowWrite).toContain('~/.cache');
    expect(config.filesystem.allowWrite).toContain('~/.local/share');
    // Defaults still present
    expect(config.filesystem.allowWrite).toContain('.');
    expect(config.filesystem.allowWrite).toContain('/tmp');
  });

  it('deduplicates allowWrite paths', () => {
    const userConfig: AutoConfig = {
      ...DEFAULT_AUTO_CONFIG,
      allowWrite: ['.', '/tmp'],
    };

    const config = buildSrtConfig('/home/user/project', userConfig);

    const tmpCount = config.filesystem.allowWrite.filter((p) => p === '/tmp').length;
    const cwdCount = config.filesystem.allowWrite.filter((p) => p === '.').length;
    expect(tmpCount).toBe(1);
    expect(cwdCount).toBe(1);
  });

  it('merges user denyWrite patterns', () => {
    const userConfig: AutoConfig = {
      ...DEFAULT_AUTO_CONFIG,
      denyWrite: ['config/production.json', '*.secret'],
    };

    const config = buildSrtConfig('/home/user/project', userConfig);

    expect(config.filesystem.denyWrite).toContain('config/production.json');
    expect(config.filesystem.denyWrite).toContain('*.secret');
    // Defaults still present
    expect(config.filesystem.denyWrite).toContain('.env');
  });

  it('merges user allowedDomains', () => {
    const userConfig: AutoConfig = {
      ...DEFAULT_AUTO_CONFIG,
      allowedDomains: ['api.example.com', 'cdn.example.net'],
    };

    const config = buildSrtConfig('/home/user/project', userConfig);

    expect(config.network.allowedDomains).toContain('api.example.com');
    expect(config.network.allowedDomains).toContain('cdn.example.net');
    // Defaults still present
    expect(config.network.allowedDomains).toContain('github.com');
  });

  it('deduplicates allowedDomains', () => {
    const userConfig: AutoConfig = {
      ...DEFAULT_AUTO_CONFIG,
      allowedDomains: ['github.com', '*.github.com'],
    };

    const config = buildSrtConfig('/home/user/project', userConfig);

    const ghCount = config.network.allowedDomains.filter((d) => d === 'github.com').length;
    expect(ghCount).toBe(1);
  });

  it('configures unix socket settings', () => {
    const config = buildSrtConfig('/home/user/project', DEFAULT_AUTO_CONFIG);

    expect(config.network.allowUnixSockets).toContain('/var/run/docker.sock');
    expect(config.network.allowAllUnixSockets).toBe(false);
    expect(config.network.allowLocalBinding).toBe(false);
  });
});
