/**
 * Independently download the public Kloks registry artifact, check its exact
 * npm SRI bytes, and import the owner-bound B2 Explorer from a clean consumer.
 * No private credentials, projects or provider calls are used.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const specifier = '@ultrst-armada/kloks@2.1.1';
const run = (args, cwd) => execFileSync('npm', args, {
  cwd, encoding: 'utf8', timeout: 180000, maxBuffer: 12 * 1024 * 1024,
  env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false' },
});
const dir = mkdtempSync(join(tmpdir(), 'kloks-registry-verified-'));
try {
  const metadata = JSON.parse(run(['view', specifier, 'dist', '--json', '--registry=https://registry.npmjs.org/'], dir));
  if (!metadata || typeof metadata.integrity !== 'string'
      || !metadata.integrity.startsWith('sha512-')
      || typeof metadata.tarball !== 'string'
      || !metadata.tarball.startsWith('https://registry.npmjs.org/')) {
    throw new Error('Public npm registry did not supply a complete verified Kloks package record.');
  }
  console.log('NPM_DIST_INTEGRITY=' + metadata.integrity);
  console.log('NPM_DIST_TARBALL=' + metadata.tarball);
  console.log('NPM_DIST_SHASUM=' + metadata.shasum);

  const packs = JSON.parse(run([
    'pack', specifier, '--json', '--ignore-scripts', '--pack-destination', dir,
    '--registry=https://registry.npmjs.org/',
  ], dir));
  if (!Array.isArray(packs) || packs.length !== 1 || !packs[0]?.filename) {
    throw new Error('Public npm tarball download did not return one artifact.');
  }
  const tarballPath = join(dir, packs[0].filename);
  const archive = readFileSync(tarballPath);
  const actualSri = 'sha512-' + createHash('sha512').update(archive).digest('base64');
  if (actualSri !== metadata.integrity) {
    throw new Error('Downloaded npm tarball SHA-512 differs from registry-published SRI.');
  }
  if (metadata.shasum && createHash('sha1').update(archive).digest('hex') !== metadata.shasum) {
    throw new Error('Downloaded npm tarball SHA-1 differs from registry-published shasum.');
  }

  const consumer = join(dir, 'consumer');
  await import('node:fs/promises').then(fs => fs.mkdir(consumer));
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({
    name: 'kloks-registry-consumer-smoke', private: true, type: 'module',
  }));
  run(['install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-save', tarballPath], consumer);

  const script = String.raw`
    import assert from 'node:assert/strict';
    import { StorageServiceFacade } from '@ultrst-armada/kloks/backend/krnl-services';
    const operation = StorageServiceFacade.definition?.operations?.executeBackblazeExplorer;
    assert.ok(operation, 'Published artifact lacks canonical B2 Explorer service operation');
    assert.equal(operation.id, 'StorageService.executeBackblazeExplorer');
    assert.equal(typeof operation.handler, 'function');
    await assert.rejects(
      operation.handler({ action: 'listBuckets', userId: '', connectionId: '' }),
      /verified owner|connection ID|owner.*required/i
    );
    console.log('PUBLISHED_B2_OWNER_BOUND_EXPORT=PASS');
  `;
  execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: consumer, stdio: 'inherit', timeout: 20000,
  });
  console.log('PUBLISHED_KLOKS_REGISTRY_SRI=PASS');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
