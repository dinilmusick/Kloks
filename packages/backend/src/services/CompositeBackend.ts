/**
 * @file CompositeBackend.ts
 * @description Composite service aggregating local services and remote proxies.
 * Invariant: Skipo.Backend = CompositeService (protocol-compatible with KrnlTS.Service).
 */

import {
  type IService,
  type ServiceDefinition,
  type OperationContext,
} from '@ultrst-armada/krnl';

export class CompositeBackend implements IService {
  public readonly id: string;
  public readonly name: string;
  public readonly version: string;

  private services: Map<string, IService> = new Map();
  private capabilitiesList: string[] = [];

  constructor(name: string, version = '1.0.0') {
    this.name = name;
    this.id = `backend-${name}`;
    this.version = version;
  }

  registerService(service: IService): this {
    this.services.set(service.name, service);
    return this;
  }

  getService(name: string): IService | undefined {
    return this.services.get(name);
  }

  getServices(): IService[] {
    return Array.from(this.services.values());
  }

  registerCapability(capability: string): this {
    if (!this.capabilitiesList.includes(capability)) {
      this.capabilitiesList.push(capability);
    }
    return this;
  }

  async start(): Promise<void> {
    for (const service of this.services.values()) {
      await service.start();
    }
  }

  async stop(): Promise<void> {
    for (const service of this.services.values()) {
      await service.stop();
    }
  }

  async call<TIn = unknown, TOut = unknown>(
    op: string,
    input?: TIn,
    ctx?: OperationContext
  ): Promise<TOut> {
    const firstDot = op.indexOf('.');
    if (firstDot === -1) {
      throw new Error(`[CompositeBackend] Invalid operation '${op}'. Expected 'service.operation'.`);
    }
    const serviceName = op.slice(0, firstDot);
    const operationName = op.slice(firstDot + 1);
    const service = this.services.get(serviceName);
    if (!service) {
      throw new Error(`[CompositeBackend] Service '${serviceName}' not registered in '${this.name}'.`);
    }
    return await service.call<TIn, TOut>(operationName, input, ctx);
  }

  getState(): Readonly<Record<string, unknown>> {
    const aggregated: Record<string, unknown> = {};
    for (const [name, service] of this.services) {
      aggregated[name] = service.getState();
    }
    return Object.freeze(aggregated);
  }

  setState(_mutation: Partial<Record<string, unknown>>): void {}

  on(event: string, handler: (payload: any) => void): () => void {
    const [serviceName, eventName] = event.split('.');
    const service = this.services.get(serviceName);
    if (!service) return () => {};
    return service.on(eventName, handler);
  }

  emit(event: string, payload: any): void {
    const [serviceName, eventName] = event.split('.');
    const service = this.services.get(serviceName);
    if (service) {
      service.emit(eventName, payload);
    }
  }

  getDefinition(): ServiceDefinition {
    const ops: Record<string, any> = {};
    for (const service of this.services.values()) {
      const def = service.getDefinition();
      for (const [opKey, opDef] of Object.entries(def.operations)) {
        ops[`${service.name}.${opKey}`] = opDef;
      }
    }

    return {
      id: this.id,
      name: this.name,
      version: this.version,
      operations: ops,
      capabilities: this.capabilitiesList.map((c) => ({
        id: c,
        name: c,
        protocols: ['http', 'ws', 'udp', 'p2p'],
      })),
      protocols: ['http', 'ws', 'udp', 'p2p'],
    };
  }
}
