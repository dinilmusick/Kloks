/**
 * @file kloks.test.ts
 * @description Comprehensive verification suite for all @kloks/* KrnlTS-based packages:
 * - @kloks/services (Service A, B, C, D)
 * - @kloks/orchestrations (Orchestrator A, B)
 * - @kloks/audio-midi (AudioHardwareService, MidiService, AudioMidiOrchestrator)
 * - @kloks/functions (FunctionsServiceFacade & pure functions)
 * - @kloks/backend (AuthServiceFacade, StorageServiceFacade, WorkspaceServiceFacade, ControlPlaneServiceFacade, ExecutionServiceFacade)
 * - @kloks/state-graph (StateLifecycleServiceFacade, NodeGraphEngineServiceFacade)
 */

import { describe, it, expect } from 'vitest';
import {
  ServiceAFacade,
  ServiceBFacade,
  ServiceCFacade,
  ServiceDFacade,
  exposeServiceD,
} from '@kloks/services';
import {
  OrchestratorAFacade,
  OrchestratorBFacade,
} from '@kloks/orchestrations';
import {
  AudioHardwareServiceFacade,
  MidiServiceFacade,
  AudioMidiOrchestratorFacade,
} from '@kloks/audio-midi';
import {
  FunctionsServiceFacade,
  toKebabCase,
} from '@kloks/functions';
import {
  AuthServiceFacade,
  StorageServiceFacade,
  WorkspaceServiceFacade,
  ControlPlaneServiceFacade,
  ExecutionServiceFacade,
} from '@kloks/backend';
import {
  StateLifecycleServiceFacade,
  NodeGraphEngineServiceFacade,
} from '@kloks/state-graph';

describe('Kloks Public Package Library (@kloks/* built on KrnlTS)', () => {
  it('Service A (Pure) & Service B (Stateful) execute and compose via Orchestrator A', async () => {
    await ServiceBFacade.execute('reset');
    const sum = await ServiceAFacade.execute<{ a: number; b: number }, { result: number }>('add', {
      a: 12,
      b: 8,
    });
    expect(sum.result).toBe(20);

    const orchA = await OrchestratorAFacade.execute({ a: 5, b: 7, operation: 'multiply' });
    expect(orchA.computed).toBe(35);
    expect(orchA.state.count).toBe(35);
  });

  it('Service B (Stateful) & Service C (Event-Emitting) compose via Orchestrator B', async () => {
    await ServiceBFacade.execute('reset');
    const orchB = await OrchestratorBFacade.execute({ delta: 10, metricName: 'requests.count' });
    expect(orchB.state.count).toBe(10);
    expect(orchB.emitted.metric).toBe('requests.count');
    expect(orchB.emitted.value).toBe(10);
  });

  it('Service D (Protocol-Enabled) exposes over HTTP and responds via KrnlTS ServiceProxy', async () => {
    expect(ServiceDFacade.deployment).toBe('remote');
    const handle = await exposeServiceD();
    const res = await handle.proxy.call<{ message: string }, { echoed: string }>('echo', {
      message: 'hello-kloks',
    });
    expect(res.echoed).toBe('hello-kloks');
    await handle.stop();
  });

  it('@kloks/audio-midi MidiService, AudioHardwareService, and AudioMidiOrchestrator operate as KrnlTS services', async () => {
    const parsed = await MidiServiceFacade.execute<
      { bytes: Uint8Array },
      { command: string; note: number; velocity: number }
    >('parseRawBytes', {
      bytes: new Uint8Array([0x90, 64, 110]),
    });
    expect(parsed.command).toBe('NOTE_ON');
    expect(parsed.note).toBe(64);
    expect(parsed.velocity).toBe(110);

    const routed = await AudioMidiOrchestratorFacade.execute({
      midiCommand: 'NOTE_ON',
      note: 60,
      velocity: 100,
      channel: 1,
    });
    expect(routed.midiEvent.command).toBe('NOTE_ON');
    expect(routed.midiEvent.note).toBe(60);
    expect(routed.audioState.sampleRate).toBeGreaterThan(0);
  });

  it('@kloks/functions FunctionsServiceFacade and pure utilities execute', async () => {
    expect(toKebabCase('KloksServicePackage')).toBe('kloks-service-package');
    const kebab = await FunctionsServiceFacade.execute<{ value: string }, string>('toKebabCase', {
      value: 'AudioHardwareService',
    });
    expect(kebab).toBe('audio-hardware-service');
  });

  it('@kloks/backend and @kloks/state-graph KrnlTS services execute cleanly', async () => {
    const wsRes = await WorkspaceServiceFacade.execute<
      { id: string; name: string },
      { valid: boolean; workspaceId: string }
    >('validateWorkspaceConfig', { id: 'ws-1', name: 'Main' });
    expect(wsRes.valid).toBe(true);

    const cpStatus = await ControlPlaneServiceFacade.execute<undefined, { healthy: boolean }>(
      'status'
    );
    expect(cpStatus.healthy).toBe(true);

    const execBoundary = await ExecutionServiceFacade.execute<
      { name: string },
      { facadeName: string; workerReady: boolean }
    >('createWorkerBoundary', { name: 'TestApp' });
    expect(execBoundary.workerReady).toBe(true);

    const storageStatus = await StorageServiceFacade.execute<
      { provider: 'local' },
      { provider: string; initialized: boolean }
    >('resolveAdapterType', { provider: 'local' });
    expect(storageStatus.initialized).toBe(true);

    const authLimit = await AuthServiceFacade.execute<{ key: string }, { allowed: boolean }>(
      'checkRateLimit',
      { key: 'user-1' }
    );
    expect(authLimit.allowed).toBe(true);

    const stateRes = await StateLifecycleServiceFacade.execute<
      { from: string; to: string },
      { graphReady: boolean }
    >('validateTransition', { from: 'IDLE', to: 'LOADING' });
    expect(stateRes.graphReady).toBe(true);

    const graphRes = await NodeGraphEngineServiceFacade.execute<
      undefined,
      { initialized: boolean }
    >('getRuleStoreStatus');
    expect(graphRes.initialized).toBe(true);
  });
});
