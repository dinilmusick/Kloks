import {decodeOscPacket,encodeOscMessage,encodeOscPacket,type OscMessage,type OscPacket} from './codec.js';
export interface OscEndpoint{
 id:string;host:string;port:number;transport:'udp'|'websocket'|'custom';
 state?:'configured'|'listening'|'stopped'|'error';
}
export interface OscTransport{
 send(endpoint:OscEndpoint,packet:Uint8Array):Promise<void>;
 listen(endpoint:OscEndpoint,listener:(packet:Uint8Array)=>void):Promise<()=>Promise<void>>;
 dispose?():Promise<void>;
}
export type OscListener=(message:OscMessage,endpointId:string)=>void;
export type OscPacketListener=(packet:OscPacket,endpointId:string)=>void;
export function matchesOscAddress(address:string,pattern:string):boolean{
 const escaped=pattern.replace(/[.+^$()|\\]/g,'\\$&').replace(/\*/g,'.*').replace(/\?/g,'.').replace(/\{([^}]+)\}/g,'($1)');
 return new RegExp('^'+escaped+'$').test(address);
}
export class OscService{
 private readonly clients=new Map<string,OscEndpoint>();
 private readonly servers=new Map<string,{endpoint:OscEndpoint;stop:()=>Promise<void>}>();
 private readonly serverStates=new Map<string,OscEndpoint>();
 private readonly listeners=new Map<string,Set<OscListener>>();
 private readonly packetListeners=new Set<OscPacketListener>();
 private disposed=false;
 constructor(private readonly transport:OscTransport){}
 addClient(endpoint:OscEndpoint){
  this.assertActive();this.assertEndpoint(endpoint);
  this.clients.set(endpoint.id,{...endpoint,state:'configured'});
 }
 getClients(){return [...this.clients.values()];}
 getServers(){return [...this.serverStates.values()];}
 async startServer(endpoint:OscEndpoint){
  this.assertActive();this.assertEndpoint(endpoint);if(this.servers.has(endpoint.id))return;
  try{
   const stop=await this.transport.listen(endpoint,packet=>{try{this.publishPacket(decodeOscPacket(packet),endpoint.id);}catch{/* malformed packets are isolated */}});
   const active={...endpoint,state:'listening' as const};
   this.servers.set(endpoint.id,{endpoint:active,stop});this.serverStates.set(endpoint.id,active);
  }catch(error){
   this.serverStates.set(endpoint.id,{...endpoint,state:'error'});
   throw error;
  }
 }
 async stopServer(id:string){
  const server=this.servers.get(id);if(!server)return;
  await server.stop();this.servers.delete(id);
  this.serverStates.set(id,{...server.endpoint,state:'stopped'});
 }
 async send(clientId:string,message:OscMessage){return this.sendPacket(clientId,message);}
 async sendPacket(clientId:string,packet:OscPacket){
  this.assertActive();const endpoint=this.clients.get(clientId);
  if(!endpoint)throw new Error('Unknown OSC client: '+clientId);
  await this.transport.send(endpoint,encodeOscPacket(packet));
 }
 subscribe(pattern:string,listener:OscListener){
  this.assertActive();const set=this.listeners.get(pattern)??new Set<OscListener>();
  set.add(listener);this.listeners.set(pattern,set);
  return()=>{set.delete(listener);if(!set.size)this.listeners.delete(pattern);};
 }
 subscribePackets(listener:OscPacketListener){
  this.assertActive();this.packetListeners.add(listener);return()=>this.packetListeners.delete(listener);
 }
 async dispose(){
  if(this.disposed)return;
  await Promise.all([...this.servers.values()].map(async server=>{await server.stop();this.serverStates.set(server.endpoint.id,{...server.endpoint,state:'stopped'});}));
  this.servers.clear();this.clients.clear();this.listeners.clear();this.packetListeners.clear();
  await this.transport.dispose?.();this.disposed=true;
 }
 private publishPacket(packet:OscPacket,id:string){
  this.packetListeners.forEach(listener=>{try{listener(packet,id);}catch{/* isolate subscriber failures */}});
  if('bundle'in packet){packet.elements.forEach(element=>this.publishPacket(element,id));return;}
  this.listeners.forEach((set,pattern)=>{
   if(matchesOscAddress(packet.address,pattern))set.forEach(listener=>{try{listener(packet,id);}catch{/* isolate subscriber failures */}});
  });
 }
 private assertEndpoint(endpoint:OscEndpoint){
  if(!endpoint.id||!endpoint.host||!Number.isInteger(endpoint.port)||endpoint.port<1||endpoint.port>65535)throw new TypeError('Invalid OSC endpoint configuration');
 }
 private assertActive(){if(this.disposed)throw new Error('OscService has been disposed');}
}
