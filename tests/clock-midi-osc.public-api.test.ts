import {describe,expect,it} from 'vitest';
import {ClockService} from '@ultrst-armada/kloks/clock';
import {MidiService,createWebMidiBackend} from '@ultrst-armada/kloks/midi';
import {OscService} from '@ultrst-armada/kloks/osc';
import {createNodeUdpOscTransport} from '@ultrst-armada/kloks/osc/node';
import {MidiServiceFacade} from '@kloks/audio-midi';
describe('canonical timing and protocol public entry points',()=>{
 it('exposes three independent service APIs and the Node-only OSC adapter',async()=>{
  expect(typeof ClockService).toBe('function');expect(typeof MidiService).toBe('function');expect(typeof OscService).toBe('function');
  expect(typeof createNodeUdpOscTransport).toBe('function');expect(typeof MidiServiceFacade.execute).toBe('function');
  const clock=new ClockService();clock.dispose();
  const midi=new MidiService(createWebMidiBackend());await midi.dispose();
  const osc=new OscService({send:async()=>{},listen:async()=>async()=>{}});
  await osc.dispose();
  const udp=createNodeUdpOscTransport();await udp.dispose();
 });
});
