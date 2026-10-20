import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Kloks services manifest', () => {
  const pkg = JSON.parse(readFileSync(resolve(process.cwd(), '../package.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(resolve(process.cwd(), '../packages/services/kloks.manifest.json'), 'utf8'));

  it('uses the public package identity and root version', () => {
    expect(manifest.package).toBe('@ultrst-armada/kloks/services');
    expect(manifest.version).toBe(pkg.version);
  });

  it('does not advertise retired entity terminology', () => {
    const readme = readFileSync(resolve(process.cwd(), '../README.md'), 'utf8');
    expect(readme).not.toContain('entities, functionalities and concept libraries');
  });
});
