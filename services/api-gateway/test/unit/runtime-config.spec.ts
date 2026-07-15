import { describe, expect, it } from 'vitest';

import { readRuntimeConfig } from '../../src/config/runtime-config';

describe('readRuntimeConfig', () => {
  it('rejects missing required configuration', () => {
    expect(() => readRuntimeConfig({})).toThrow('PORT is required');
  });

  it('parses a configured port', () => {
    expect(readRuntimeConfig({ PORT: '4100' })).toEqual({ port: 4100 });
  });

  it.each(['0', '65536', 'not-a-number', '3000.5'])(
    'rejects the invalid port %s',
    (port) => {
      expect(() => readRuntimeConfig({ PORT: port })).toThrow(
        'PORT must be an integer between 1 and 65535',
      );
    },
  );
});
