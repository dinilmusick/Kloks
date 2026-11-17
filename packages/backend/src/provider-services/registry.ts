import type { ProviderDefinition } from './types.js';

/** One canonical catalog, independent of account instances and secrets. */
const definitions: readonly ProviderDefinition[] = [
  { id: 'cloudflare', name: 'Cloudflare', category: 'deployment', status: 'ready',
    credentialModes: ['api-token'], capabilities: ['workers','pages','usage'], renewal: 'daily',
    apiImplemented: true, usageImplemented: true, docsUrl: 'https://developers.cloudflare.com/api/' },
  { id: 'vercel', name: 'Vercel', category: 'deployment', status: 'ready',
    credentialModes: ['api-token'], capabilities: ['projects','deployments','usage'], renewal: 'monthly',
    apiImplemented: true, usageImplemented: true, docsUrl: 'https://vercel.com/docs/rest-api' },
  { id: 'google', name: 'Google', kind: 'suite', category: 'suite', status: 'ready',
    credentialModes: ['oauth2'], capabilities: ['identity'], renewal: 'unknown',
    apiImplemented: true, usageImplemented: false, docsUrl: 'https://developers.google.com/identity' },
  { id: 'google-gemini', parentId: 'google', name: 'Gemini Developer API', category: 'ai', status: 'ready',
    credentialModes: ['api-key'], capabilities: ['models','inference'], renewal: 'daily',
    apiImplemented: true, usageImplemented: false, docsUrl: 'https://ai.google.dev/gemini-api/docs' },
  { id: 'google-drive', parentId: 'google', name: 'Google Drive', category: 'storage', status: 'ready',
    credentialModes: ['oauth2'], capabilities: ['files','folders'], renewal: 'ongoing',
    apiImplemented: true, usageImplemented: false, docsUrl: 'https://developers.google.com/workspace/drive/api' },
  { id: 'google-cloud-run', parentId: 'google', name: 'Google Cloud Run', category: 'cloud', status: 'catalogued',
    credentialModes: ['oauth2'], capabilities: ['services','deployments'], renewal: 'monthly',
    apiImplemented: false, usageImplemented: false, docsUrl: 'https://cloud.google.com/run/docs' },
  { id: 'google-cloud-storage', parentId: 'google', name: 'Google Cloud Storage', category: 'storage', status: 'catalogued',
    credentialModes: ['oauth2'], capabilities: ['buckets','objects'], renewal: 'ongoing',
    apiImplemented: false, usageImplemented: false, docsUrl: 'https://cloud.google.com/storage/docs' },
  { id: 'google-cloud-shell', parentId: 'google', name: 'Google Cloud Shell', category: 'cloud', status: 'catalogued',
    credentialModes: ['oauth2'], capabilities: ['terminal'], renewal: 'unknown',
    apiImplemented: false, usageImplemented: false, docsUrl: 'https://cloud.google.com/shell/docs' },
  { id: 'google-vertex-ai', parentId: 'google', name: 'Vertex AI', category: 'ai', status: 'catalogued',
    credentialModes: ['oauth2'], capabilities: ['inference','models'], renewal: 'monthly',
    apiImplemented: false, usageImplemented: false, docsUrl: 'https://cloud.google.com/vertex-ai/docs' },
  { id: 'backblaze-b2', name: 'Backblaze B2', category: 'storage', status: 'ready',
    credentialModes: ['application-key'], capabilities: ['buckets','files'], renewal: 'ongoing',
    apiImplemented: true, usageImplemented: false, docsUrl: 'https://www.backblaze.com/docs/cloud-storage' },
  { id: 'github', name: 'GitHub', category: 'storage', status: 'ready',
    credentialModes: ['oauth2','api-token'], capabilities: ['repositories','contents'],
    renewal: 'ongoing', apiImplemented: true, usageImplemented: false, docsUrl: 'https://docs.github.com/en/rest' },
  { id: 'gitlab', name: 'GitLab.com', category: 'storage', status: 'ready',
    credentialModes: ['oauth2','api-token'], capabilities: ['projects','repository-tree'],
    renewal: 'ongoing', apiImplemented: true, usageImplemented: false, docsUrl: 'https://docs.gitlab.com/api/' },
  { id: 'dropbox', name: 'Dropbox', category: 'storage', status: 'ready',
    credentialModes: ['oauth2'], capabilities: ['list-folder','pagination'],
    renewal: 'ongoing', apiImplemented: true, usageImplemented: false, docsUrl: 'https://www.dropbox.com/developers/documentation/http/documentation' },
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
  google_drive: 'google-drive', google_cloud_storage: 'google-cloud-storage',
  github_repos: 'github', gitlab_repos: 'gitlab',
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

/** Tree view for SRKL and any consumer presenting provider families. */
export interface ProviderServiceNode extends ProviderDefinition {
  children: ProviderServiceNode[];
}

/** Return direct children without exposing internal registry arrays. */
export function listProviderServiceChildren(parentId: string): ProviderDefinition[] {
  const id = resolveProviderServiceId(parentId);
  return listProviderServices().filter(service => service.parentId === id);
}

/** Canonical nested view: Google is a parent suite, Drive/Gemini/etc are children. */
export function listProviderServiceTree(): ProviderServiceNode[] {
  const nodes = new Map(listProviderServices().map(service => [
    service.id, { ...service, children: [] } as ProviderServiceNode,
  ]));
  const roots: ProviderServiceNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId && nodes.get(node.parentId);
    if (parent && parent.id !== node.id) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/** Resolve a service's identity chain for breadcrumbs and authorization scopes. */
export function getProviderServicePath(id: string): ProviderDefinition[] {
  const path: ProviderDefinition[] = [];
  const visited = new Set<string>();
  let current = getProviderService(id);
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    path.unshift(current);
    current = current.parentId ? getProviderService(current.parentId) : undefined;
  }
  return path;
}
