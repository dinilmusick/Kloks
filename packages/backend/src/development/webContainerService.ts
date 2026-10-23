import {
  createService,
  createServiceDefinition,
  type IService,
  type ServiceDefinition,
} from '@ultrst-armada/krnl';
import type { WebContainerCommand } from './types.js';

const COMMANDS: Record<string, WebContainerCommand> = {
  install: { command: 'pnpm', args: ['install', '--no-frozen-lockfile'] },
  lint: { command: 'pnpm', args: ['lint'] },
  test: { command: 'pnpm', args: ['test'] },
  build: { command: 'pnpm', args: ['build'] },
  validate: { command: 'pnpm', args: ['lint'] },
  check: { command: 'pnpm', args: ['lint'] },
};

export interface WebContainerRunCommandInput {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string | number | boolean>;
}

let runQueue: Promise<void> = Promise.resolve();

export class WebContainerRuntime {
  private container: any = null;
  private instancePromise: Promise<any> | null = null;

  async boot() {
    if (typeof window !== 'undefined' && !window.crossOriginIsolated) {
      throw new Error('WebContainer requires a cross-origin-isolated page. Ensure COOP=same-origin and COEP=require-corp are served.');
    }
    if (this.container) return this.container;
    if (!this.instancePromise) {
      this.instancePromise = import('@webcontainer/api').then(async module => {
        const container = await module.WebContainer.boot({
          coep: 'require-corp',
          workdirName: 'kloks-development',
        });
        this.container = container;
        return container;
      }).catch(error => {
        this.instancePromise = null;
        throw error;
      });
    }
    return this.instancePromise;
  }

  async mount(files: Record<string, unknown>) {
    const container = await this.boot();
    await container.mount(files);
    return { mounted: true };
  }

  private async runProcess(command: string, args: string[], cwd?: string, env?: Record<string, string | number | boolean>) {
    const container = await this.boot();
    const process = await container.spawn(command, args, { cwd, env });
    let output = '';
    const reader = process.output.getReader();
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        output += next.value;
      }
    } finally {
      reader.releaseLock();
    }
    return { exitCode: await process.exit, output };
  }

  async run(task: keyof typeof COMMANDS, cwd?: string, env?: Record<string, string>) {
    const spec = COMMANDS[task];
    return this.runCommand(spec.command, spec.args, cwd, env);
  }

  async runCommand(command: string, args: string[] = [], cwd?: string, env?: Record<string, string | number | boolean>) {
    const previous = runQueue;
    let release!: () => void;
    runQueue = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      return await this.runProcess(command, args, cwd, env);
    } finally {
      release();
    }
  }

  async teardown() {
    const container = this.container;
    this.container = null;
    this.instancePromise = null;
    container?.teardown();
    return { tornDown: true };
  }
}

const runtime = new WebContainerRuntime();

export const WebContainerServiceDefinition: ServiceDefinition = createServiceDefinition({
  id: 'kloks.backend.webContainer',
  name: 'WebContainerService',
  version: '1.1.0',
  operations: {
    boot: { id: 'WebContainerService.boot', name: 'boot', handler: async () => { await runtime.boot(); return { ready: true }; } },
    mount: { id: 'WebContainerService.mount', name: 'mount', handler: async (input: { files: Record<string, unknown> }) => runtime.mount(input.files) },
    run: { id: 'WebContainerService.run', name: 'run', handler: async (input: { task: keyof typeof COMMANDS; cwd?: string; env?: Record<string, string> }) => runtime.run(input.task, input.cwd, input.env) },
    runCommand: { id: 'WebContainerService.runCommand', name: 'runCommand', handler: async (input: WebContainerRunCommandInput) => runtime.runCommand(input.command, input.args, input.cwd, input.env) },
    teardown: { id: 'WebContainerService.teardown', name: 'teardown', handler: async () => runtime.teardown() },
    command: { id: 'WebContainerService.command', name: 'command', handler: async (input: { task: keyof typeof COMMANDS }) => ({ task: input.task, command: COMMANDS[input.task] }) },
  },
});

export const WebContainerServiceFacade = {
  id: WebContainerServiceDefinition.id,
  name: WebContainerServiceDefinition.name,
  version: WebContainerServiceDefinition.version,
  runtime: 'client' as const,
  deployment: 'local' as const,
  definition: WebContainerServiceDefinition,
  createInstance: () => createService(WebContainerServiceDefinition),
  execute: async <TIn = unknown, TOut = unknown>(op: string, input?: TIn) => {
    const instance: IService = createService(WebContainerServiceDefinition);
    await instance.start();
    return instance.call<TIn, TOut>(op, input);
  },
};
