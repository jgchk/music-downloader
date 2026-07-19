import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('defaults the HTTP port when unset', () => {
    expect(loadConfig({})._unsafeUnwrap()).toEqual({ httpPort: 3000 });
  });

  it('reads an explicit HTTP port from the environment', () => {
    expect(loadConfig({ HTTP_PORT: '4000' })._unsafeUnwrap()).toEqual({ httpPort: 4000 });
  });

  it('rejects a non-numeric HTTP port', () => {
    expect(loadConfig({ HTTP_PORT: 'not-a-port' }).isErr()).toBe(true);
  });
});
