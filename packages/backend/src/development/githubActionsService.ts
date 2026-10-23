import {
  createService,
  createServiceDefinition,
  type IService,
  type ServiceDefinition,
} from '@ultrst-armada/krnl';

export interface GitHubActionsConfig {
  token: string;
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface WorkflowRun {
  id: number;
  name?: string;
  status?: string;
  conclusion?: string | null;
  html_url?: string;
}

export interface GitHubActionsResult<T = unknown> {
  data: T;
  status: number;
  ok: boolean;
}

export class GitHubActionsClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: GitHubActionsConfig) {
    this.baseUrl = config.apiBaseUrl ?? 'https://api.github.com';
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<GitHubActionsResult<T>> {
    const response = await this.fetchImpl(this.baseUrl + path, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.config.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.headers ?? {}),
      },
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!response.ok) {
      throw new Error(`GitHub Actions request failed (${response.status}): ${data?.message ?? response.statusText}`);
    }
    return { data, status: response.status, ok: true };
  }

  async listWorkflowRuns(repository: string, workflowId?: string | number, branch?: string) {
    const suffix = workflowId ? `/actions/workflows/${workflowId}/runs` : '/actions/runs';
    const query = branch ? `?branch=${encodeURIComponent(branch)}` : '';
    return this.request<{ workflow_runs: WorkflowRun[] }>(`/repos/${repository}${suffix}${query}`);
  }

  async getWorkflowRun(repository: string, runId: number) {
    return this.request<WorkflowRun>(`/repos/${repository}/actions/runs/${runId}`);
  }

  async getWorkflowJobs(repository: string, runId: number) {
    return this.request<{ jobs: Array<{ id: number; name: string; status: string; conclusion?: string | null }> }>(
      `/repos/${repository}/actions/runs/${runId}/jobs`,
    );
  }

  async dispatchWorkflow(repository: string, workflowId: string | number, ref: string, inputs: Record<string, string> = {}) {
    return this.request<void>(`/repos/${repository}/actions/workflows/${workflowId}/dispatches`, {
      method: 'POST',
      body: JSON.stringify({ ref, inputs }),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async rerunWorkflow(repository: string, runId: number) {
    return this.request<void>(`/repos/${repository}/actions/runs/${runId}/rerun`, { method: 'POST' });
  }

  async rerunFailedJobs(repository: string, runId: number) {
    return this.request<void>(`/repos/${repository}/actions/runs/${runId}/rerun-failed-jobs`, { method: 'POST' });
  }

  async cancelWorkflow(repository: string, runId: number) {
    return this.request<void>(`/repos/${repository}/actions/runs/${runId}/cancel`, { method: 'POST' });
  }
}

export const GitHubActionsServiceDefinition: ServiceDefinition = createServiceDefinition({
  id: 'kloks.backend.githubActions',
  name: 'GitHubActionsService',
  version: '1.0.0',
  operations: {
    listWorkflowRuns: { id: 'GitHubActionsService.listWorkflowRuns', name: 'listWorkflowRuns', handler: async (input: { repository: string; workflowId?: string | number; branch?: string }) => new GitHubActionsClient({ token: String(input.repository) }).listWorkflowRuns(input.repository, input.workflowId, input.branch) },
  },
});

export const GitHubActionsServiceFacade = {
  id: GitHubActionsServiceDefinition.id,
  name: GitHubActionsServiceDefinition.name,
  version: GitHubActionsServiceDefinition.version,
  runtime: 'server' as const,
  deployment: 'remote' as const,
  definition: GitHubActionsServiceDefinition,
  createInstance: () => createService(GitHubActionsServiceDefinition),
  execute: async <TIn = unknown, TOut = unknown>(op: string, input?: TIn) => {
    const instance: IService = createService(GitHubActionsServiceDefinition);
    await instance.start();
    return instance.call<TIn, TOut>(op, input);
  },
};
