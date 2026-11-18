import { describe, expect, it } from 'vitest';
import { createConsentedUiAgentAccess, type UiAgentConsentGrant } from './uiSessionAgentAccess.js';

const tabA = '2743a144-98ac-4be0-a90b-f8868237d1cb';
const tabB = 'f7d89b23-f537-4a54-a9b5-a462ad41d0e3';
const rev = '63599882-203c-43e1-a9c7-60322e1507b1';
const caller = { userId: 'alice', appId: 'aiko', workspaceId: 'workspace-A' };
function fixture() {
  const grants = new Map<string,UiAgentConsentGrant>();
  const approve: string[] = [];
  const calls: string[] = [];
  let allowed = true;
  function grant(windowId: string, tabId: string, permissions: UiAgentConsentGrant['permissions'] = ['inspect','action']) {
    grants.set(windowId, { windowId, tabId, permissions, consented: true, grantId: 'grant-'+windowId,
      origin:'https://aiko.example',expiresAt:Date.now()+30000,...caller });
  }
  grant('window-A',tabA);grant('window-B',tabB);
  const access = createConsentedUiAgentAccess({
    verifyCaller: s => s === 'alice-session' ? caller :
      s === 'other-workspace' ? { ...caller, workspaceId: 'workspace-B' } : null,
    authorizeWindow: (_,window) => grants.get(window) ?? null,
    approveAction: (_caller,_grant,action) => {approve.push(action.controlId);return allowed;},
    sanitizeSnapshot: (_caller,_grant,snapshot) => ({ visible: (snapshot as {visible:string}).visible }),
    uiSession: async (request,input) => {
      calls.push(request.method+':'+new URL(request.url).pathname+':'+input.principalId);
      const tab = new URL(request.url).pathname.split('/')[3];
      if (!grants.size || ![tabA,tabB].includes(tab)) return Response.json({}, {status:404});
      if (request.method === 'GET') return Response.json({session:{
        revision:rev,snapshot:{visible:tab,secret:'must-not-leak'} }});
      return Response.json({actionId: 'queue-1'}, {status:202});
    },
  });
  return {access, grants, approve, calls, stop:()=>{allowed=false;}, grant};
}
describe('consented UI agent access over existing Kloks UI session authority',()=>{
  it('isolates two live windows for one verified principal and sanitizes snapshots', async()=>{
    const f=fixture();
    const [a,b]=await Promise.all([f.access.inspect('alice-session','window-A'),
      f.access.inspect('alice-session','window-B')]);
    expect(a.snapshot).toEqual({ visible:tabA });
    expect(b.snapshot).toEqual({ visible:tabB });
    expect(a).not.toHaveProperty('secret');
    expect(f.calls).toEqual([
      'GET:/api/ui-session/'+tabA+':alice','GET:/api/ui-session/'+tabB+':alice']);
  });
  it('denies missing consent, forged users, workspace switches, closed or revoked tabs',async()=>{
    const f=fixture();
    await expect(f.access.inspect('invalid','window-A')).rejects.toThrow('verified Luth');
    await expect(f.access.inspect('other-workspace','window-A')).rejects.toThrow('consent');
    f.grants.delete('window-A');
    await expect(f.access.inspect('alice-session','window-A')).rejects.toThrow('consent');
    await expect(f.access.inspect('alice-session',tabA)).rejects.toThrow('consent');
  });
  it('requires per-action approval and rechecks live grant before queuing',async()=>{
    const f=fixture();
    const result=await f.access.action('alice-session','window-A',{
      revision:rev,componentId:'tiles',controlId:'select',payload:1});
    expect(result).toEqual({windowId:'window-A',status:'queued',actionId:'queue-1'});
    expect(f.approve).toEqual(['select']);
    expect(f.calls).toEqual(['POST:/api/ui-session/'+tabA+'/action:alice']);
    f.stop();
    await expect(f.access.action('alice-session','window-A',{
      revision:rev,componentId:'tiles',controlId:'select'})).rejects.toThrow('approval');
  });
  it('rejects timeouts and rebinds between approval and dispatch',async()=>{
    const f=fixture();
    f.grants.set('window-A',{...f.grants.get('window-A')!,expiresAt:Date.now()-1});
    await expect(f.access.inspect('alice-session','window-A')).rejects.toThrow('consent');
    let active = true;
    const mutable=fixture();
    const wrapped=createConsentedUiAgentAccess({
      verifyCaller:()=>caller,
      authorizeWindow:(_,id)=>mutable.grants.get(id) ?? null,
      approveAction:()=>{ if(active) mutable.grants.delete('window-A');active=false;return true;},
      sanitizeSnapshot:()=>({}),
      uiSession:async()=>Response.json({actionId:'impossible'},{status:202}),
    });
    await expect(wrapped.action('alice-session','window-A',{
      revision:rev,componentId:'tiles',controlId:'select'})).rejects.toThrow('consent');
  });
});
