import {decodeMidiMessage,encodeMidiMessage,type MidiMessage} from './message.js';
import {MidiManager as LegacyMidiManager} from '../midiManager.js';
export interface MidiDevice{id:string;name:string;manufacturer?:string;direction:'input'|'output'|'duplex';origin:'physical'|'logical';state:'connected'|'disconnected';capabilities:{input:boolean;output:boolean;virtualDeviceCreation:boolean};}
export interface MidiBackend{
 readonly capabilities:{physicalInput:boolean;physicalOutput:boolean;virtualDeviceCreation:boolean};
 discover():Promise<MidiDevice[]>;
 connectInput(id:string,listener:(message:MidiMessage)=>void):Promise<void>;
 connectOutput(id:string):Promise<void>;
 send(id:string,bytes:Uint8Array):Promise<void>;
 disconnect(id:string):Promise<void>;
 dispose():Promise<void>;
}
export class MidiService{
 private devices=new Map<string,MidiDevice>();private listeners=new Set<(message:MidiMessage,deviceId:string)=>void>();
 private deviceListeners=new Set<(devices:MidiDevice[])=>void>();private logical=new Map<string,Set<(message:MidiMessage)=>void>>();private disposed=false;
 constructor(private readonly backend:MidiBackend){}
 getCapabilities(){return {...this.backend.capabilities,logicalEndpoints:true};}
 getDevices(){return [...this.devices.values()];}
 async discover(){this.assertActive();const found=await this.backend.discover();const ids=new Set(found.map(d=>d.id));
  for(const [id,device] of this.devices)if(device.origin==='physical'&&!ids.has(id))this.devices.delete(id);
  for(const device of found)this.devices.set(device.id,device);this.publishDevices();return this.getDevices();}
 createLogicalDevice(name:string,direction:'input'|'output'|'duplex'='duplex'):MidiDevice{
  this.assertActive();if(!name.trim())throw new TypeError('Logical MIDI device name is required');
  const id='logical-midi-'+Math.random().toString(36).slice(2);
  const device:MidiDevice={id,name:name.trim(),direction,origin:'logical',state:'connected',capabilities:{input:direction!=='output',output:direction!=='input',virtualDeviceCreation:false}};
  this.devices.set(id,device);this.logical.set(id,new Set());this.publishDevices();return device;}
 async connectInput(id:string){this.assertActive();const d=this.requireDevice(id);if(!d.capabilities.input)throw new Error('Device does not support MIDI input');if(d.origin==='logical')return;await this.backend.connectInput(id,m=>this.publishMessage(m,id));this.setState(id,'connected');}
 async connectOutput(id:string){this.assertActive();const d=this.requireDevice(id);if(!d.capabilities.output)throw new Error('Device does not support MIDI output');if(d.origin==='logical')return;await this.backend.connectOutput(id);this.setState(id,'connected');}
 async send(id:string,message:MidiMessage){this.assertActive();const d=this.requireDevice(id);if(!d.capabilities.output)throw new Error('Device does not support MIDI output');if(d.origin==='physical'&&d.state!=='connected')throw new Error('MIDI output is not connected');if(d.origin==='logical'){this.publishMessage(message,id);this.logical.get(id)?.forEach(fn=>{try{fn(message);}catch{/* isolate logical subscriber failures */}});return;}await this.backend.send(id,encodeMidiMessage(message));}
 subscribe(fn:(message:MidiMessage,deviceId:string)=>void){this.assertActive();this.listeners.add(fn);return()=>this.listeners.delete(fn);}
 subscribeDevices(fn:(devices:MidiDevice[])=>void){this.assertActive();this.deviceListeners.add(fn);fn(this.getDevices());return()=>this.deviceListeners.delete(fn);}
 subscribeLogicalInput(id:string,fn:(message:MidiMessage)=>void){this.assertActive();const set=this.logical.get(id);if(!set)throw new Error('Unknown logical MIDI device');set.add(fn);return()=>set.delete(fn);}
 async disconnect(id:string){this.assertActive();const d=this.requireDevice(id);if(d.origin==='physical')await this.backend.disconnect(id);this.setState(id,'disconnected');}
 async dispose(){if(this.disposed)return;await this.backend.dispose();this.listeners.clear();this.deviceListeners.clear();this.logical.clear();this.devices.clear();this.disposed=true;}
 private publishMessage(message:MidiMessage,id:string){this.listeners.forEach(fn=>{try{fn(message,id);}catch{/* isolate subscriber failures */}});}
 private setState(id:string,state:MidiDevice['state']){this.devices.set(id,{...this.requireDevice(id),state});this.publishDevices();}
 private publishDevices(){const snapshot=this.getDevices();this.deviceListeners.forEach(fn=>{try{fn(snapshot);}catch{/* isolate subscriber failures */}});}
 private requireDevice(id:string){const d=this.devices.get(id);if(!d)throw new Error('Unknown MIDI device: '+id);return d;}
 private assertActive(){if(this.disposed)throw new Error('MidiService has been disposed');}
}
/**
 * Adapts the existing Kloks MidiManager to the capability-based service contract.
 * Device discovery, hot-plug handling and physical I/O remain owned by one canonical manager.
 */
export function createWebMidiBackend(manager: LegacyMidiManager = new LegacyMidiManager()): MidiBackend {
  const inputSubscriptions = new Map<string, () => void>();
  const supported = typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
  const ensureInitialized = async () => {
    if (!supported) return false;
    if (!manager.getState().isInitialized) await manager.initialize({ sysex: false, software: true });
    return true;
  };
  return {
    capabilities: { physicalInput: supported, physicalOutput: supported, virtualDeviceCreation: false },
    async discover() {
      if (!(await ensureInitialized())) return [];
      const state = manager.getState();
      const devices = new Map<string, MidiDevice>();
      state.inputs.forEach(port => devices.set(port.id, {
        id: port.id, name: port.name, manufacturer: port.manufacturer,
        direction: 'input', origin: 'physical',
        state: port.state === 'connected' && port.connection === 'open' ? 'connected' : 'disconnected',
        capabilities: { input: true, output: false, virtualDeviceCreation: false },
      }));
      state.outputs.forEach(port => {
        const previous = devices.get(port.id);
        devices.set(port.id, {
          id: port.id, name: port.name, manufacturer: port.manufacturer ?? previous?.manufacturer,
          direction: previous ? 'duplex' : 'output', origin: 'physical',
          state: port.state === 'connected' && port.connection === 'open' ? 'connected' : 'disconnected',
          capabilities: { input: Boolean(previous?.capabilities.input), output: true, virtualDeviceCreation: false },
        });
      });
      return [...devices.values()];
    },
    async connectInput(id, listener) {
      if (!(await ensureInitialized())) throw new Error('Web MIDI is unavailable in this runtime');
      if (!manager.getState().inputs.some(port => port.id === id)) throw new Error('MIDI input not discovered: ' + id);
      if (!inputSubscriptions.has(id)) {
        inputSubscriptions.set(id, manager.subscribeEvents(event => {
          if (event.sourceId === id) listener(decodeMidiMessage(event.rawBytes));
        }));
      }
      await manager.connectInput(id);
    },
    async connectOutput(id) {
      if (!(await ensureInitialized())) throw new Error('Web MIDI is unavailable in this runtime');
      await manager.connectOutput(id);
    },
    async send(id, bytes) { manager.sendRawMidiBytes(bytes, id); },
    async disconnect(id) {
      inputSubscriptions.get(id)?.();
      inputSubscriptions.delete(id);
      await Promise.all([manager.disconnectInput(id), manager.disconnectOutput(id)]);
    },
    async dispose() {
      inputSubscriptions.forEach(unsubscribe => unsubscribe());
      inputSubscriptions.clear();
      manager.dispose();
    },
  };
}
