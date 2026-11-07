import {describe,expect,it} from 'vitest';
import {decodeOscMessage,decodeOscPacket,encodeOscBundle,encodeOscMessage,type OscBundle} from '../src/osc/codec.js';
import {matchesOscAddress,OscService,type OscTransport} from '../src/osc/service.js';
describe('OSC protocol and service',()=>{
 it('round-trips scalar, blob and 64-bit argument types',()=>{
  const message={address:'/synth/voice',args:[42,0.25,'hello',true,false,null,1234567890123n,new Uint8Array([1,2,3])]};
  const decoded=decodeOscMessage(encodeOscMessage(message));expect(decoded.address).toBe(message.address);expect(decoded.args.slice(0,7)).toEqual(message.args.slice(0,7));expect(decoded.args[7]).toEqual(message.args[7]);
 });
 it('round-trips nested OSC bundles and time tags',()=>{
  const bundle:OscBundle={bundle:true,timetag:123456789n,elements:[{address:'/clock/tick',args:[1]},{bundle:true,timetag:1n,elements:[{address:'/nested',args:[true]}]}]};
  expect(decodeOscPacket(encodeOscBundle(bundle))).toEqual(bundle);
 });
 it('rejects malformed packets and invalid addresses',()=>{
  expect(()=>encodeOscMessage({address:'missing-slash',args:[]})).toThrow();expect(()=>decodeOscPacket(new Uint8Array([47,0,0,0]))).toThrow();
 });
 it('matches patterns and provides independent client/server lifecycle',async()=>{
  expect(matchesOscAddress('/synth/voice/12','/synth/voice/*')).toBe(true);
  let receive:((packet:Uint8Array)=>void)|null=null;let sent=0,stopped=0;
  const transport:OscTransport={send:async()=>{sent++;},listen:async(_e,fn)=>{receive=fn;return async()=>{stopped++;};}};
  const service=new OscService(transport);service.addClient({id:'out',host:'127.0.0.1',port:9000,transport:'udp'});
  await service.send('out',{address:'/ping',args:[1]});expect(sent).toBe(1);
  const messages:string[]=[];service.subscribe('/ping',message=>messages.push(message.address));
  await service.startServer({id:'in',host:'0.0.0.0',port:9001,transport:'udp'});
  receive?.(encodeOscMessage({address:'/ping',args:[]}));expect(messages).toEqual(['/ping']);
  await service.dispose();expect(stopped).toBe(1);
 });
});
