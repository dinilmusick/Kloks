import { describe, expect, it } from 'vitest';
import { getProviderService, listProviderServiceTree, listRecognizedAccountServices } from './registry.js';
import { getFreeComputeOffer, listFreeComputeOffers } from './free-compute.js';
describe('Frnes renewable compute offer catalogue', () => {
  it('provides cited, typed renewals without granting allocation authority', () => {
    const offers = listFreeComputeOffers();
    expect(offers.length).toBeGreaterThanOrEqual(30);
    for (const offer of offers) {
      expect(offer.sourceUrl).toMatch(/^https:\/\//);
      expect(offer.verifiedDate).toBe('2026-11-20');
      expect(offer.allocationEnabled).toBe(false);
      expect(offer.allowance.length).toBeGreaterThan(8);
      expect(getProviderService(offer.providerId)?.freeCompute?.providerId).toBe(offer.providerId);
    }
  });
  it('represents weekly restricted GPU notebooks without provisioning access', () => {
    expect(getFreeComputeOffer('kaggle-notebooks')?.renewal).toBe('weekly');
    expect(getFreeComputeOffer('kaggle-notebooks')?.access).toBe('restricted');
    expect(getProviderService('kaggle-notebooks')?.apiImplemented).toBe(false);
    expect(getFreeComputeOffer('github-actions')?.workload).toBe('ci');
    expect(getFreeComputeOffer('github-codespaces')?.access).toBe('restricted');
  });
  it('keeps parent providers grouped and old implemented services intact', () => {
    const tree = listProviderServiceTree();
    expect(tree.find(x=>x.id==='google')?.children.some(x=>x.id==='google-app-engine')).toBe(true);
    expect(tree.find(x=>x.id==='google')?.children.some(x=>x.id==='firebase-functions')).toBe(true);
    expect(tree.find(x=>x.id==='cloudflare')?.children.some(x=>x.id==='cloudflare-browser-run')).toBe(true);
    expect(tree.find(x=>x.id==='github')?.children.some(x=>x.id==='github-actions')).toBe(true);
    const recognized = listRecognizedAccountServices().map(x=>x.id);
    expect(recognized).toContain('cloudflare');
    expect(recognized).toContain('railway');
    expect(recognized).not.toContain('modal');
    expect(recognized).not.toContain('kaggle-notebooks');
  });
  it('returns copies rather than exposing mutable canonical registry metadata', () => {
    const offer = getFreeComputeOffer('modal')!;
    offer.allowance='corrupted';
    expect(getFreeComputeOffer('modal')?.allowance).toContain('$30');
  });
});