# Canonical Clock, MIDI and OSC services

The Clock, MIDI and OSC services are independent service boundaries. None imports another service.

## Application clock

```ts
import { createClockKernelService } from '@ultrst-armada/kloks/clock';
const clock = createClockKernelService();
await clock.start();
const position = await clock.call('getPosition');
await clock.call('setTempo', { tempo: 96 });
await clock.call('pause');
await clock.call('resume');
await clock.stop();
await clock.dispose();
```

The underlying `ClockService` class also supports direct use. Musical position is derived from monotonic time and beat anchors; tempo changes preserve accumulated position. The scheduler supports catch-up and skip policies for delayed callbacks. It is not an audio engine.

## MIDI protocol and devices

```ts
import { MidiService, createWebMidiBackend } from '@ultrst-armada/kloks/midi';
const midi = new MidiService(createWebMidiBackend());
const devices = await midi.discover();
const unsubscribe = midi.subscribe((message, deviceId) => inspectMidi(message, deviceId));
const input = devices.find(device => device.capabilities.input);
if (input) await midi.connectInput(input.id);
const logical = midi.createLogicalDevice('Internal routing bus');
await midi.send(logical.id, { type: 'noteOn', channel: 0, noteOrController: 60, value: 96 });
unsubscribe();
await midi.dispose();
```

Physical discovery and logical in-process endpoints are distinct. The Web MIDI backend adapts Kloks' existing MidiManager, so discovery, hot-plug events and physical port lifecycle remain owned by one canonical manager. It supports physical input/output only where the runtime exposes Web MIDI. It does not create OS-level virtual MIDI ports. Native, Node, WebContainer and desktop environments inject their own capability-appropriate backends.

## OSC protocol and endpoints

```ts
import { OscService } from '@ultrst-armada/kloks/osc';
import { createNodeUdpOscTransport } from '@ultrst-armada/kloks/osc/node';
const osc = new OscService(createNodeUdpOscTransport());
osc.addClient({ id: 'synth', host: '127.0.0.1', port: 9000, transport: 'udp' });
const unsubscribe = osc.subscribe('/synth/*', message => inspectOsc(message));
await osc.send('synth', { address: '/synth/volume', args: [0.75] });
await osc.startServer({ id: 'controller', host: '0.0.0.0', port: 9001, transport: 'udp' });
unsubscribe();
await osc.dispose();
```

OSC supports int32, float32, string, blob, int64, float64, timetag, boolean, nil and impulse arguments plus nested bundles. Packet subscriptions preserve bundles and their unsigned timetags; address-pattern subscriptions expose contained messages for application-level scheduling. Node UDP binds real UDP sockets. Browser/WebContainer applications inject a WebSocket relay or another runtime transport; browsers cannot bind arbitrary UDP ports. Legacy OscManager remains an in-memory event hub only and no longer advertises simulated endpoints as live devices.

## Application-level composition

The clock remains independent. Applications compose services when required:

```ts
clock.onTick(({ tick }) => {
  if (tick % 24 === 0) {
    void midi.send(outputId, { type: 'controlChange', channel: 0, noteOrController: 1, value: 64 });
    void osc.send(clientId, { address: '/transport/beat', args: [tick / 24] });
  }
});
```

## Runtime capabilities

| Runtime | Clock | MIDI | OSC |
| --- | --- | --- | --- |
| Browser | Monotonic browser clock | Web MIDI when exposed and permission granted | Inject WebSocket/bridge transport; no native UDP bind |
| Node/server | Monotonic runtime clock | Inject native MIDI backend | Node UDP transport |
| WebContainer | Generic clock | Capability-dependent; no assumed hardware access | Inject network relay; no assumed UDP bind |
| Desktop/native | Generic clock | Inject native backend; virtual ports only if confirmed by backend | UDP or native transport |
| Future hardware | Generic clock | Runtime-specific driver | Runtime-specific transport |

Applications own cross-service scheduling and composition. All services expose deterministic cleanup.
