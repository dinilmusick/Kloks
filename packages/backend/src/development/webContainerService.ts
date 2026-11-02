import {
  createService,
  createServiceDefinition,
  type IService,
  type ServiceDefinition,
} from '@ultrst-armada/krnl';
import type { DevelopmentTask, WebContainerCommand } from './types.js';

const COMMANDS: Record<DevelopmentTask, WebContainerCommand> = {
  install: { command: 'pnpm', args: ['install', '--no-frozen-lockfile'] },
  lint: { command: 'pnpm', args: ['lint'] },
  test: { command: 'pnpm', args: ['test'] },
  build: { command: 'pnpm', args: ['build'] },
  validate: { command: 'pnpm', args: ['validate'] },
  check: { command: 'pnpm', args: ['lint'] },
};

export function resolveWebContainerCommand(task: DevelopmentTask): WebContainerCommand {
  const command = COMMANDS[task];
  return { command: command.command, args: [...command.args] };
}

export interface WebContainerRunCommandInput {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string | number | boolean>;
}

let runQueue: Promise<void> = Promise.resolve();
let sharedContainer: any = null;
let sharedContainerPromise: Promise<any> | null = null;

export class WebContainerRuntime {
  async boot() {
    if (typeof window !== 'undefined' && !window.crossOriginIsolated) {
      throw new Error('WebContainer requires a cross-origin-isolated page. Ensure COOP=same-origin and COEP=require-corp are served.');
    }
    if (sharedContainer) return sharedContainer;
    if (!sharedContainerPromise) {
      sharedContainerPromise = import('@webcontainer/api').then(async module => {
        const container = await module.WebContainer.boot({
          coep: 'require-corp',
          workdirName: 'kloks-development',
        });
        sharedContainer = container;
        return container;
      }).catch(error => {
        sharedContainerPromise = null;
        throw error;
      });
    }
    return sharedContainerPromise;
  }

  async mount(files: Record<string, unknown>, mountPoint?: string) {
    const container = await this.boot();
    await container.mount(files, mountPoint ? { mountPoint } : undefined);
    return { mounted: true, mountPoint: mountPoint ?? '/' };
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

  async run(task: DevelopmentTask, cwd?: string, env?: Record<string, string>) {
    const spec = resolveWebContainerCommand(task);
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

  async spawnCommand(command: string, args: string[] = [], cwd?: string, env?: Record<string, string | number | boolean>) {
    const container = await this.boot();
    return container.spawn(command, args, { cwd, env });
  }

  async teardown() {
    const container = sharedContainer;
    sharedContainer = null;
    sharedContainerPromise = null;
    await container?.teardown();
    return { tornDown: true };
  }
}

export const WebContainerServiceDefinition: ServiceDefinition = createServiceDefinition({
  id: 'kloks.backend.webContainer',
  name: 'WebContainerService',
  version: '1.2.0',
  operations: {
    boot: { id: 'WebContainerService.boot', name: 'boot', handler: async () => { await runtime.boot(); return { ready: true }; } },
    mount: { id: 'WebContainerService.mount', name: 'mount', handler: async (input: { files: Record<string, unknown>; mountPoint?: string }) => runtime.mount(input.files, input.mountPoint) },
    run: { id: 'WebContainerService.run', name: 'run', handler: async (input: { task: DevelopmentTask; cwd?: string; env?: Record<string, string> }) => runtime.run(input.task, input.cwd, input.env) },
    runCommand: { id: 'WebContainerService.runCommand', name: 'runCommand', handler: async (input: WebContainerRunCommandInput) => runtime.runCommand(input.command, input.args, input.cwd, input.env) },
    teardown: { id: 'WebContainerService.teardown', name: 'teardown', handler: async () => runtime.teardown() },
    command: { id: 'WebContainerService.command', name: 'command', handler: async (input: { task: DevelopmentTask }) => ({ task: input.task, command: resolveWebContainerCommand(input.task) }) },
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
