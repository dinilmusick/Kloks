import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Kloks services manifest', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const manifest = JSON.parse(readFileSync(new URL('../packages/services/kloks.manifest.json', import.meta.url), 'utf8'));

  it('uses the public package identity and root version', () => {
    expect(manifest.package).toBe('@ultrst-armada/kloks/services');
    expect(manifest.version).toBe(pkg.version);
  });

  it('does not advertise retired entity terminology', () => {
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    expect(readme).not.toContain('entities, functionalities and concept libraries');
  });
});
