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

export class WebContainerRuntime {
  private container: any = null;

  async boot() {
    if (this.container) return this.container;
    const module = await import('@webcontainer/api');
    this.container = await module.WebContainer.boot();
    return this.container;
  }

  async mount(files: Record<string, unknown>) {
    const container = await this.boot();
    await container.mount(files);
    return { mounted: true };
  }

  async run(task: keyof typeof COMMANDS, cwd?: string, env?: Record<string, string>) {
    const container = await this.boot();
    const spec = COMMANDS[task];
    const process = await container.spawn(spec.command, spec.args, { cwd, env });
    let output = '';
    await process.output.pipeTo(new WritableStream({ write(chunk) { output += chunk; } }));
    return { exitCode: await process.exit, output };
  }

  async teardown() {
    this.container?.teardown();
    this.container = null;
    return { tornDown: true };
  }
}

const runtime = new WebContainerRuntime();

export const WebContainerServiceDefinition: ServiceDefinition = createServiceDefinition({
  id: 'kloks.backend.webContainer',
  name: 'WebContainerService',
  version: '1.0.0',
  operations: {
    boot: { id: 'WebContainerService.boot', name: 'boot', handler: async () => { await runtime.boot(); return { ready: true }; } },
    mount: { id: 'WebContainerService.mount', name: 'mount', handler: async (input: { files: Record<string, unknown> }) => runtime.mount(input.files) },
    run: { id: 'WebContainerService.run', name: 'run', handler: async (input: { task: keyof typeof COMMANDS; cwd?: string; env?: Record<string, string> }) => runtime.run(input.task, input.cwd, input.env) },
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
