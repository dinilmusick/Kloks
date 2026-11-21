import { describe, expect, it, vi } from 'vitest';
import {
  saveVerifiedProviderAccount, listSavedProviderAccounts,
  readSavedProviderAccount, revokeSavedProviderAccount,
} from './saved-account-store.js';
import { validateSavedProviderInput } from './saved-account-probe.js';
import { encryptSavedCredential, decryptSavedCredential } from './saved-account-crypto.js';

const token = 'credential-not-for-output';
const key = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const scope = 'a'.repeat(32);
function database() {
  const rows: any[] = [];
  const query = async (sql: string, args: unknown[] = []) => {
    if (sql.includes('FROM public."ultrst-credentials"')) return { rows: [{
      id:'system', credentials:{storageConnections:{encryptionKey:key,encryptionKeyVersion:1}},
    }] };
    if (sql.includes('INSERT INTO public.frnes_provider_accounts')) {
      const [id,owner,workspace,provider,kind,accountScope,projectId,region,label,checked,envelope] = args;
      const row = { id,owner_user_id:owner,workspace_id:workspace,provider_id:provider,resource_kind:kind,
        account_scope:accountScope,project_id:projectId,region,label,enabled:true,
        checked_at:checked,created_at:new Date().toISOString(),
        credential_envelope:JSON.parse(String(envelope)),revoked_at:null };
      rows.push(row); return { rows: [row] };
    }
    if (sql.includes('UPDATE public.frnes_provider_accounts')) {
      const row=rows.find(x=>x.owner_user_id===args[0] && x.workspace_id===args[1] && x.id===args[2] && !x.revoked_at);
      if (!row) return { rows:[] };
      row.enabled=false;row.revoked_at=new Date().toISOString();
      return { rows:[{id:row.id}] };
    }
    if (sql.includes('FROM public.frnes_provider_accounts')) {
      return { rows:rows.filter(x=>x.owner_user_id===args[0] &&
        x.workspace_id===args[1] && !x.revoked_at &&
        (args.length<3 || x.id===args[2]) &&
        (args.length<3 || !sql.includes('enabled=true') || x.enabled)) };
    }
    return { rows:[] };
  };
  return {query:query as any,rows};
}
function providerApi() {
  return vi.fn(async (url: RequestInfo | URL, options?: RequestInit) => {
    const request=String(url);
    const auth=(options?.headers as Record<string,string>)?.Authorization || '';
    if (auth !== 'Bearer ' + token) return new Response('{}',{status:403});
    if (request === 'https://api.cloudflare.com/client/v4/accounts/'+scope+'/workers/scripts')
      return Response.json({success:true,result:[{id:'my-worker'}]});
    if (request === 'https://api.vercel.com/v9/projects?teamId=team_1')
      return Response.json({projects:[{id:'prj_1',name:'My project'}]});
    if (request === 'https://api.machines.dev/v1/apps')
      return Response.json({apps:[{name:'my-app'}]});
    if (request === 'https://api.render.com/v1/services?limit=20')
      return Response.json([{service:{id:'srv-1',name:'my-service'}}]);
    if (request === 'https://backboard.railway.com/graphql/v2')
      return Response.json({data:{me:{name:'My Railway account'}}});
    if (request === 'https://run.googleapis.com/v2/projects/project-123/locations/us-central1/services')
      return Response.json({services:[{name:'projects/project-123/locations/us-central1/services/my-service'}]});
    throw new Error('Unexpected test URL');
  }) as unknown as typeof fetch;
}
const account=(providerId:string,resourceKind:string,rest:any={})=>({
  providerId, resourceKind, credential:token,label:'Connected account',...rest,
});
describe('Frnes Kloks saved cloud-provider accounts',()=>{
  it('validates and probes all six actual provider API integrations before storage',async()=>{
    const values=[
      account('cloudflare','workers',{accountScope:scope}),
      account('vercel','projects',{accountScope:'team_1'}),
      account('fly','apps'), account('render','services'),
      account('railway','identity'),
      account('google-cloud-run','services',{projectId:'project-123',region:'us-central1'}),
    ];
    const db=database(), transport=providerApi();
    for(const input of values) {
      const saved=await saveVerifiedProviderAccount('owner-1','ws-one',input as any,{
        query:db.query,transport });
      expect(saved.providerId).toBe(input.providerId);
      expect(saved.enabled).toBe(true);
      expect(JSON.stringify(saved)).not.toContain(token);
      const read=await readSavedProviderAccount('owner-1','ws-one',saved.id,{query:db.query,transport});
      expect(read.resources).toHaveLength(1);
      expect(read.complete).toBe(false);
      expect(JSON.stringify(read)).not.toContain(token);
    }
    expect(db.rows).toHaveLength(6);
    expect(JSON.stringify(db.rows)).not.toContain(token);
    expect(db.rows[0].credential_envelope.algorithm).toBe('AES-GCM-256');
    expect(await listSavedProviderAccounts('owner-1','ws-one',db.query)).toHaveLength(6);
  });
  it('refuses cross-owner reads and revokes exact account access',async()=>{
    const db=database(),transport=providerApi();
    const saved=await saveVerifiedProviderAccount('owner-1','ws-one',account('fly','apps'),{query:db.query,transport});
    const calls=(transport as any).mock.calls.length;
    await expect(readSavedProviderAccount('owner-2','ws-one',saved.id,{query:db.query,transport}))
      .rejects.toThrow(/DENIED/);
    expect((transport as any).mock.calls).toHaveLength(calls);
    await expect(readSavedProviderAccount('owner-1','ws-two',saved.id,{query:db.query,transport}))
      .rejects.toThrow(/DENIED/);
    expect(await listSavedProviderAccounts('owner-1','ws-two',db.query)).toEqual([]);
    expect(await revokeSavedProviderAccount('owner-2','ws-one',saved.id,db.query)).toBe(false);
    expect(await revokeSavedProviderAccount('owner-1','ws-one',saved.id,db.query)).toBe(true);
    await expect(readSavedProviderAccount('owner-1','ws-one',saved.id,{query:db.query,transport}))
      .rejects.toThrow(/DENIED/);
  });
  it('rejects invalid/foreign provider scopes before network and database',async()=>{
    const db=database(),transport=providerApi();
    for(const value of [
      account('cloudflare','workers'),
      account('vercel','workers'),
      account('fly','apps',{accountScope:'unauthorized'}),
      account('google-cloud-run','services',{projectId:'../../foreign',region:'us-central1'}),
      account('render','services',{credential:'invalid credential'}),
      account('oracle-cloud','instances'),
    ]) {
      expect(()=>validateSavedProviderInput(value)).toThrow();
      await expect(saveVerifiedProviderAccount('owner-1','ws-one',value as any,{
        query:db.query,transport })).rejects.toThrow();
    }
    expect(db.rows).toHaveLength(0);
    expect((transport as any).mock.calls).toHaveLength(0);
  });
  it('authenticates AES-GCM encryption to owner, account and scope',async()=>{
    const bound={ownerUserId:'owner-1',workspaceId:'ws-one',id:'account-1',providerId:'fly',
      resourceKind:'apps',accountScope:'',projectId:'',region:''};
    const encrypted=await encryptSavedCredential(token,key,bound);
    expect(JSON.stringify(encrypted)).not.toContain(token);
    expect(await decryptSavedCredential(encrypted,key,bound)).toBe(token);
    await expect(decryptSavedCredential(encrypted,key,{
      ...bound,ownerUserId:'owner-2',
    })).rejects.toThrow(/DECRYPTION_DENIED/);
    await expect(decryptSavedCredential(encrypted,key,{
      ...bound,workspaceId:'ws-two',
    })).rejects.toThrow(/DECRYPTION_DENIED/);
    await expect(decryptSavedCredential(encrypted,key,{
      ...bound,resourceKind:'services',
    })).rejects.toThrow(/DECRYPTION_DENIED/);
  });
});
