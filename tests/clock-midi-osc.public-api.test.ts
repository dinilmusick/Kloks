import {describe,expect,it} from 'vitest';
import {ClockService,createClockKernelService} from '@ultrst-armada/kloks/clock';
import {MidiService,createWebMidiBackend,createMidiKernelService,type MidiBackend} from '@ultrst-armada/kloks/midi';
import {OscService,createOscKernelService,type OscTransport} from '@ultrst-armada/kloks/osc';
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
 it('registers each service with KrnlTS lifecycle and cleans up independently',async()=>{
  const clock=createClockKernelService();await clock.start();await clock.call('setTempo',{tempo:96});expect(clock.getState().tempo).toBe(96);await clock.stop();await clock.dispose();

  const midiBackend:MidiBackend={capabilities:{physicalInput:false,physicalOutput:false,virtualDeviceCreation:false},discover:async()=>[],connectInput:async()=>{},connectOutput:async()=>{},send:async()=>{},disconnect:async()=>{},dispose:async()=>{}};
  const midi=createMidiKernelService(midiBackend);await midi.start();const logical=await midi.call('createLogicalDevice',{name:'App route'});expect(logical.origin).toBe('logical');await midi.stop();await midi.dispose();

  let stopped=0;
  const transport:OscTransport={send:async()=>{},listen:async()=>async()=>{stopped++;}};
  const osc=createOscKernelService(transport);await osc.start();
  await osc.call('addClient',{id:'client',host:'127.0.0.1',port:9000,transport:'udp'});
  await osc.call('startServer',{id:'server',host:'0.0.0.0',port:9001,transport:'udp'});
  expect(osc.getState().servers[0].state).toBe('listening');await osc.stop();
  expect(osc.getState().servers[0].state).toBe('stopped');await osc.dispose();expect(stopped).toBe(1);
 });
});
