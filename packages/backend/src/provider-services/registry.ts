import type { ProviderDefinition } from './types.js';

/** One canonical catalog, independent of account instances and secrets. */
const definitions: readonly ProviderDefinition[] = [
  { id: 'cloudflare', name: 'Cloudflare', category: 'deployment', status: 'ready',
    credentialModes: ['api-token'], capabilities: ['workers','pages','usage'], renewal: 'daily',
    apiImplemented: true, usageImplemented: true, docsUrl: 'https://developers.cloudflare.com/api/' },
  { id: 'vercel', name: 'Vercel', category: 'deployment', status: 'ready',
    credentialModes: ['api-token'], capabilities: ['projects','deployments','usage'], renewal: 'monthly',
    apiImplemented: true, usageImplemented: true, docsUrl: 'https://vercel.com/docs/rest-api' },
  { id: 'google', name: 'Google Account', category: 'cloud', status: 'catalogued',
    credentialModes: ['oauth2'], capabilities: ['identity'], renewal: 'unknown',
    apiImplemented: false, usageImplemented: false, docsUrl: 'https://developers.google.com/identity' },
  { id: 'google-gemini', parentId: 'google', name: 'Gemini Developer API', category: 'ai', status: 'ready',
    credentialModes: ['api-key'], capabilities: ['models','inference'], renewal: 'daily',
    apiImplemented: true, usageImplemented: false, docsUrl: 'https://ai.google.dev/gemini-api/docs' },
  { id: 'google-drive', parentId: 'google', name: 'Google Drive', category: 'storage', status: 'ready',
    credentialModes: ['oauth2'], capabilities: ['files','folders'], renewal: 'ongoing',
    apiImplemented: true, usageImplemented: false, docsUrl: 'https://developers.google.com/workspace/drive/api' },
  { id: 'google-cloud-run', parentId: 'google', name: 'Google Cloud Run', category: 'cloud', status: 'catalogued',
    credentialModes: ['oauth2'], capabilities: ['services','deployments'], renewal: 'monthly',
    apiImplemented: false, usageImplemented: false, docsUrl: 'https://cloud.google.com/run/docs' },
  { id: 'backblaze-b2', name: 'Backblaze B2', category: 'storage', status: 'ready',
    credentialModes: ['application-key'], capabilities: ['buckets','files'], renewal: 'ongoing',
    apiImplemented: true, usageImplemented: false, docsUrl: 'https://www.backblaze.com/docs/cloud-storage' },
  { id: 'groq', name: 'Groq', category: 'ai', status: 'catalogued',
    credentialModes: ['api-key'], capabilities: ['inference','models'], renewal: 'daily',
    apiImplemented: false, usageImplemented: false, docsUrl: 'https://console.groq.com/docs/rate-limits' },
  { id: 'cerebras', name: 'Cerebras', category: 'ai', status: 'catalogued',
    credentialModes: ['api-key'], capabilities: ['inference','models'], renewal: 'daily',
    apiImplemented: false, usageImplemented: false, docsUrl: 'https://inference-docs.cerebras.ai/' },
  { id: 'huggingface', name: 'Hugging Face', category: 'ai', status: 'catalogued',
    credentialModes: ['api-token'], capabilities: ['inference','models'], renewal: 'monthly',
    apiImplemented: false, usageImplemented: false, docsUrl: 'https://huggingface.co/docs/inference-providers/pricing' },
  { id: 'openrouter', name: 'OpenRouter (free models)', category: 'ai', status: 'catalogued',
    credentialModes: ['api-key'], capabilities: ['inference','models'], renewal: 'daily',
    apiImplemented: false, usageImplemented: false, docsUrl: 'https://openrouter.ai/collections/free-models' },
  { id: 'render', name: 'Render', category: 'deployment', status: 'catalogued',
    credentialModes: ['api-key'], capabilities: ['services','deployments'], renewal: 'monthly',
    apiImplemented: false, usageImplemented: false, docsUrl: 'https://render.com/docs/free' },
  { id: 'railway', name: 'Railway', category: 'deployment', status: 'catalogued',
    credentialModes: ['api-token'], capabilities: ['projects','deployments'], renewal: 'monthly',
    apiImplemented: false, usageImplemented: false, docsUrl: 'https://docs.railway.com/pricing/plans' },
  { id: 'oracle-cloud', name: 'Oracle Cloud Always Free', category: 'cloud', status: 'catalogued',
    credentialModes: ['api-key'], capabilities: ['instances'], renewal: 'ongoing',
    apiImplemented: false, usageImplemented: false, docsUrl: 'https://www.oracle.com/cloud/free/' },
  { id: 'replit', name: 'Replit', category: 'developer', status: 'catalogued',
    credentialModes: ['api-token'], capabilities: ['development'], renewal: 'unknown',
    apiImplemented: false, usageImplemented: false, docsUrl: 'https://docs.replit.com/' },
  { id: 'fly', name: 'Fly.io (one-time trial)', category: 'cloud', status: 'excluded',
    credentialModes: ['api-token'], capabilities: ['machines'], renewal: 'trial',
    apiImplemented: false, usageImplemented: false, docsUrl: 'https://fly.io/docs/about/free-trial/' },
  { id: 'openai', name: 'OpenAI API', category: 'ai', status: 'excluded',
    credentialModes: ['api-key'], capabilities: ['inference'], renewal: 'unknown',
    apiImplemented: false, usageImplemented: false, docsUrl: 'https://platform.openai.com/docs' },
  { id: 'xai', name: 'xAI Grok API', category: 'ai', status: 'excluded',
    credentialModes: ['api-key'], capabilities: ['inference'], renewal: 'unknown',
    apiImplemented: false, usageImplemented: false, docsUrl: 'https://docs.x.ai/' },
];
const byId = new Map(definitions.map(def => [def.id, def]));
const aliases: Record<string, string> = {
  cloudflare_workers: 'cloudflare', cloudflare_pages: 'cloudflare',
  gemini: 'google-gemini', google_ai_studio: 'google-gemini',
  backblaze: 'backblaze-b2', backblaze_b2: 'backblaze-b2',
};

export function resolveProviderServiceId(id: string): string {
  const clean = String(id || '').trim().toLowerCase().replace(/-/g, '_');
  return aliases[clean] ?? clean.replace(/_/g, '-');
}
export function getProviderService(id: string): ProviderDefinition | undefined {
  const item = byId.get(resolveProviderServiceId(id));
  return item && { ...item, credentialModes: [...item.credentialModes], capabilities: [...item.capabilities] };
}
export function listProviderServices(category?: ProviderDefinition['category']): ProviderDefinition[] {
  return definitions.filter(item => !category || item.category === category)
    .map(item => getProviderService(item.id)!);
}
/** SRKL should expose only services with a real canonical implementation. */
export function listRecognizedAccountServices(): ProviderDefinition[] {
  return listProviderServices().filter(item => item.status === 'ready' && item.apiImplemented);
}
