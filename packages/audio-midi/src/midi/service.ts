import {decodeMidiMessage,encodeMidiMessage,type MidiMessage} from './message.js';
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
 async send(id:string,message:MidiMessage){this.assertActive();const d=this.requireDevice(id);if(!d.capabilities.output)throw new Error('Device does not support MIDI output');if(d.origin==='logical'){this.publishMessage(message,id);this.logical.get(id)?.forEach(fn=>fn(message));return;}await this.backend.send(id,encodeMidiMessage(message));}
 subscribe(fn:(message:MidiMessage,deviceId:string)=>void){this.assertActive();this.listeners.add(fn);return()=>this.listeners.delete(fn);}
 subscribeDevices(fn:(devices:MidiDevice[])=>void){this.assertActive();this.deviceListeners.add(fn);fn(this.getDevices());return()=>this.deviceListeners.delete(fn);}
 subscribeLogicalInput(id:string,fn:(message:MidiMessage)=>void){this.assertActive();const set=this.logical.get(id);if(!set)throw new Error('Unknown logical MIDI device');set.add(fn);return()=>set.delete(fn);}
 async disconnect(id:string){this.assertActive();const d=this.requireDevice(id);if(d.origin==='physical')await this.backend.disconnect(id);this.setState(id,'disconnected');}
 async dispose(){if(this.disposed)return;await this.backend.dispose();this.listeners.clear();this.deviceListeners.clear();this.logical.clear();this.devices.clear();this.disposed=true;}
 private publishMessage(message:MidiMessage,id:string){this.listeners.forEach(fn=>fn(message,id));}
 private setState(id:string,state:MidiDevice['state']){this.devices.set(id,{...this.requireDevice(id),state});this.publishDevices();}
 private publishDevices(){const snapshot=this.getDevices();this.deviceListeners.forEach(fn=>fn(snapshot));}
 private requireDevice(id:string){const d=this.devices.get(id);if(!d)throw new Error('Unknown MIDI device: '+id);return d;}
 private assertActive(){if(this.disposed)throw new Error('MidiService has been disposed');}
}
type WebMidiInput={id:string;name?:string|null;manufacturer?:string|null;state?:string;onmidimessage:((event:{data:ArrayLike<number>})=>void)|null};
type WebMidiOutput={id:string;name?:string|null;manufacturer?:string|null;state?:string;send(data:number[]):void};
type WebMidiAccess={inputs:{forEach(fn:(port:WebMidiInput)=>void):void};outputs:{forEach(fn:(port:WebMidiOutput)=>void):void}};
type WebMidiNavigator=Navigator&{requestMIDIAccess?:(options?:{sysex?:boolean})=>Promise<WebMidiAccess>};
export function createWebMidiBackend():MidiBackend{
 const nav=typeof navigator==='undefined'?null:navigator as WebMidiNavigator;
 const supported=typeof nav?.requestMIDIAccess==='function';
 let access:WebMidiAccess|null=null;const inputs=new Map<string,WebMidiInput>();const outputs=new Map<string,WebMidiOutput>();
 return{
  capabilities:{physicalInput:supported,physicalOutput:supported,virtualDeviceCreation:false},
  async discover(){if(!nav?.requestMIDIAccess)return[];access=access??await nav.requestMIDIAccess({sysex:false});inputs.clear();outputs.clear();
   access.inputs.forEach(p=>inputs.set(p.id,p));access.outputs.forEach(p=>outputs.set(p.id,p));const found:MidiDevice[]=[];
   inputs.forEach(p=>found.push({id:p.id,name:p.name??p.id,manufacturer:p.manufacturer??undefined,direction:'input',origin:'physical',state:p.state==='connected'?'connected':'disconnected',capabilities:{input:true,output:false,virtualDeviceCreation:false}}));
   outputs.forEach(p=>found.push({id:p.id,name:p.name??p.id,manufacturer:p.manufacturer??undefined,direction:'output',origin:'physical',state:p.state==='connected'?'connected':'disconnected',capabilities:{input:false,output:true,virtualDeviceCreation:false}}));return found;},
  async connectInput(id,listener){const p=inputs.get(id);if(!p)throw new Error('MIDI input not discovered');p.onmidimessage=e=>listener(decodeMidiMessage(e.data));},
  async connectOutput(id){if(!outputs.has(id))throw new Error('MIDI output not discovered');},
  async send(id,bytes){const p=outputs.get(id);if(!p)throw new Error('MIDI output not discovered');p.send(Array.from(bytes));},
  async disconnect(id){const p=inputs.get(id);if(p)p.onmidimessage=null;},
  async dispose(){inputs.forEach(p=>p.onmidimessage=null);inputs.clear();outputs.clear();access=null;}
 };
}
