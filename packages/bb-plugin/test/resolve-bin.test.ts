import { describe, expect, it } from 'vitest';
import { resolveRehearse } from '../src/resolve-bin.js';

const has = (...paths: string[]) => (p: string) => paths.includes(p);

describe('resolveRehearse', () => {
  it('uses the setting first', () => {
    expect(resolveRehearse('/repo', '/opt/rehearse', has())).toEqual({ command: '/opt/rehearse', prefix: [] });
    expect(resolveRehearse('/repo', 'rehearse-dev', has())).toEqual({ command: 'rehearse-dev', prefix: [] });
    expect(resolveRehearse('/repo', 'tools/rehearse.js', has())).toEqual({ command: 'node', prefix: ['/repo/tools/rehearse.js'] });
  });
  it("uses the repo's node_modules/.bin, also from a sub folder", () => {
    expect(resolveRehearse('/repo/docs', '', has('/repo/node_modules/.bin/rehearse'))).toEqual({
      command: '/repo/node_modules/.bin/rehearse',
      prefix: [],
    });
  });
  it('uses packages/cli/bin/rehearse.js in the rehearse repo itself', () => {
    expect(resolveRehearse('/repo', '', has('/repo/packages/cli/bin/rehearse.js'))).toEqual({
      command: 'node',
      prefix: ['/repo/packages/cli/bin/rehearse.js'],
    });
  });
  it('falls back to rehearse on PATH', () => {
    expect(resolveRehearse('/repo', '  ', has())).toEqual({ command: 'rehearse', prefix: [] });
  });
});
