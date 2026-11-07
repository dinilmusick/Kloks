import { createClockKernelService } from './clock/kernel.js';
import { ClockService, type ClockOptions } from './clock/clock.js';
import { createMidiKernelService } from './midi/kernel.js';
import { createWebMidiBackend, type MidiBackend } from './midi/service.js';
import { createOscKernelService } from './osc/kernel.js';
import type { OscTransport } from './osc/service.js';
import type { IService, ServiceDefinition } from '@ultrst-armada/krnl';

/** Default timing facade; each Skipo app can create an isolated clock instance. */
const defaultClockService = createClockKernelService();
export const ClockServiceDefinition: ServiceDefinition = defaultClockService.getDefinition();
export const ClockServiceFacade = {
  id: ClockServiceDefinition.id,
  name: ClockServiceDefinition.name,
  version: ClockServiceDefinition.version,
  runtime: 'client' as const,
  deployment: 'local' as const,
  definition: ClockServiceDefinition,
  createInstance: (options: ClockOptions = {}) => createClockKernelService(new ClockService(options)),
  execute: async <TIn = unknown, TOut = unknown>(operation: string, input?: TIn) => {
    await defaultClockService.start();
    return defaultClockService.call<TIn, TOut>(operation, input);
  },
};

/** Capability-gated Web MIDI facade. Native/server backends are injected per application. */
const defaultMidiService = createMidiKernelService(createWebMidiBackend());
export const CanonicalMidiServiceDefinition: ServiceDefinition = defaultMidiService.getDefinition();
export const CanonicalMidiServiceFacade = {
  id: CanonicalMidiServiceDefinition.id,
  name: CanonicalMidiServiceDefinition.name,
  version: CanonicalMidiServiceDefinition.version,
  runtime: 'client' as const,
  deployment: 'local' as const,
  definition: CanonicalMidiServiceDefinition,
  createInstance: (backend: MidiBackend = createWebMidiBackend()) => createMidiKernelService(backend),
  execute: async <TIn = unknown, TOut = unknown>(operation: string, input?: TIn) => {
    await defaultMidiService.start();
    return defaultMidiService.call<TIn, TOut>(operation, input);
  },
};

/** No implicit/fake network backend: applications must inject a real OSC transport. */
const unconfiguredOscTransport: OscTransport = {
  send: async () => { throw new Error('OSC transport is not configured; inject a runtime-specific OscTransport.'); },
  listen: async () => { throw new Error('OSC transport is not configured; inject a runtime-specific OscTransport.'); },
};
const defaultOscService = createOscKernelService(unconfiguredOscTransport);
export const OscServiceDefinition: ServiceDefinition = defaultOscService.getDefinition();
export const OscServiceFacade = {
  id: OscServiceDefinition.id,
  name: OscServiceDefinition.name,
  version: OscServiceDefinition.version,
  runtime: 'client' as const,
  deployment: 'local' as const,
  definition: OscServiceDefinition,
  createInstance: (transport: OscTransport = unconfiguredOscTransport): IService => createOscKernelService(transport),
  execute: async <TIn = unknown, TOut = unknown>(operation: string, input?: TIn) => {
    await defaultOscService.start();
    return defaultOscService.call<TIn, TOut>(operation, input);
  },
};
