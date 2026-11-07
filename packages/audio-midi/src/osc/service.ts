import { decodeOscPacket, encodeOscMessage, type OscMessage, type OscPacket } from './codec.js';
export interface OscEndpoint{id:string;host:string;port:number;transport:'udp'|'websocket'|'custom';}
export interface OscTransport{
 send(endpoint:OscEndpoint,packet:Uint8Array):Promise<void>;
 listen(endpoint:OscEndpoint,listener:(packet:Uint8Array)=>void):Promise<()=>Promise<void>>;
 dispose?():Promise<void>;
}
export type OscListener=(message:OscMessage,endpointId:string)=>void;
export function matchesOscAddress(address:string,pattern:string):boolean{
 const escaped=pattern.replace(/[.+^$()|\\]/g,'\\$&').replace(/\*/g,'.*').replace(/\?/g,'.').replace(/\{([^}]+)\}/g,'($1)');
 return new RegExp('^'+escaped+'$').test(address);
}
export class OscService{
 private readonly clients=new Map<string,OscEndpoint>();
 private readonly servers=new Map<string,{endpoint:OscEndpoint;stop:()=>Promise<void>}>();
 private readonly listeners=new Map<string,Set<OscListener>>();
 private disposed=false;
 constructor(private readonly transport:OscTransport){}
 addClient(endpoint:OscEndpoint){this.assertEndpoint(endpoint);this.clients.set(endpoint.id,endpoint);}
 getClients(){return [...this.clients.values()];}
 getServers(){return [...this.servers.values()].map(server=>server.endpoint);}
 async startServer(endpoint:OscEndpoint){
  this.assertActive();this.assertEndpoint(endpoint);if(this.servers.has(endpoint.id))return;
  const stop=await this.transport.listen(endpoint,packet=>{try{this.publishPacket(decodeOscPacket(packet),endpoint.id);}catch{/* malformed packet is isolated */}});
  this.servers.set(endpoint.id,{endpoint,stop});
 }
 async stopServer(id:string){const server=this.servers.get(id);if(!server)return;await server.stop();this.servers.delete(id);}
 async send(clientId:string,message:OscMessage){this.assertActive();const endpoint=this.clients.get(clientId);if(!endpoint)throw new Error('Unknown OSC client: '+clientId);await this.transport.send(endpoint,encodeOscMessage(message));}
 subscribe(pattern:string,listener:OscListener){this.assertActive();const set=this.listeners.get(pattern)??new Set<OscListener>();set.add(listener);this.listeners.set(pattern,set);return()=>{set.delete(listener);if(!set.size)this.listeners.delete(pattern);};}
 async dispose(){if(this.disposed)return;await Promise.all([...this.servers.values()].map(server=>server.stop()));this.servers.clear();this.clients.clear();this.listeners.clear();await this.transport.dispose?.();this.disposed=true;}
 private publishPacket(packet:OscPacket,id:string){if('bundle'in packet){packet.elements.forEach(element=>this.publishPacket(element,id));return;}this.listeners.forEach((set,pattern)=>{if(matchesOscAddress(packet.address,pattern))set.forEach(listener=>listener(packet,id));});}
 private assertEndpoint(e:OscEndpoint){if(!e.id||!e.host||!Number.isInteger(e.port)||e.port<1||e.port>65535)throw new TypeError('Invalid OSC endpoint configuration');}
 private assertActive(){if(this.disposed)throw new Error('OscService has been disposed');}
}
