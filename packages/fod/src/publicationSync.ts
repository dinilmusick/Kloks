/**
 * Metadata-only, server-side FOD workflow publication transport.
 *
 * The source graph, execution payload, credentials and workspace contents never
 * leave FOD storage. This adapter requires an authenticated server-side caller;
 * it does not grant access or authorize execution on behalf of a consumer.
 */
export type FodPublicationState='published'|'withdrawn';

export interface FodPublicationDescriptor {
  appId:string;
  ownerUserId:string;
  workspaceId:string;
  workflowId:string;
  version:number;
  displayName:string;
  description?:string;
  state:FodPublicationState;
}
export interface FodPublicationSink {
  synchronize(descriptor:FodPublicationDescriptor):Promise<void>;
}
export interface FodPublicationOptions {
  /** Trusted, Luth-authenticated host context; NEVER derive from flow metadata. */
  appId:string;
  ownerUserId:string;
  sink:FodPublicationSink;
}
export type FodPublicationQuery=(sql:string,args:readonly unknown[])=>Promise<unknown>;

export function validatePublicationDescriptor(d:FodPublicationDescriptor):void {
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(d.appId)) throw new Error('Invalid canonical publication app_id.');
  for (const [name,value] of [
    ['owner',d.ownerUserId],['workspace',d.workspaceId],['workflow',d.workflowId],
    ['display name',d.displayName],
  ] as const) {
    if (typeof value!=='string' || !value.trim()) throw new Error('Missing publication '+name+'.');
  }
  if (!Number.isSafeInteger(d.version) || d.version<1) throw new Error('Invalid publication version.');
  if (d.state!=='published' && d.state!=='withdrawn') throw new Error('Invalid publication state.');
}

/**
 * One parameterized statement makes withdrawal of old published revisions and
 * publication of the selected revision atomic. The operation is idempotent,
 * so an interrupted local save can be reconciled at startup/reconnect.\n * Withdrawal creates an equal-version tombstone even when no publish landed.\n * Stale events cannot unpublish newer versions or revive withdrawn versions;\n * republishing after withdrawal must create a new immutable version.
 *
 * Caller must be a trusted server-side registry writer. Grant verification,
 * owner/workspace ACL and version checks are independently enforced at the
 * owning app on EVERY invocation; the global catalog is discovery only.
 */
export function createSqlFodPublicationSink(query:FodPublicationQuery):FodPublicationSink {
  return {
    async synchronize(d) {
      validatePublicationDescriptor(d);
      const sql=`
WITH withdrawn AS (
  UPDATE skipo_ecosystem.workflow_publications
     SET publication_state='withdrawn', withdrawn_at=clock_timestamp()
   WHERE app_id=$1 AND owner_user_id=$2 AND workspace_id=$3 AND workflow_id=$4
     AND publication_state='published'
     -- Only older versions are withdrawn here. The equal-version
     -- tombstone is inserted or updated by withdrawal_marker below.
     AND version<$5::integer
  RETURNING id
), withdrawal_marker AS (
  -- A withdrawal must leave a durable marker EVEN IF a publish never reached
  -- this registry. Otherwise a delayed publish could resurrect that version.
  INSERT INTO skipo_ecosystem.workflow_publications
    (app_id,owner_user_id,workspace_id,workflow_id,version,display_name,
     description,publication_state,withdrawn_at)
  SELECT $1,$2,$3,$4,$5,$6,$7,'withdrawn',clock_timestamp()
   WHERE $8::text='withdrawn'
  ON CONFLICT (app_id,owner_user_id,workspace_id,workflow_id,version)
    DO UPDATE SET publication_state='withdrawn',
                  withdrawn_at=COALESCE(
                    skipo_ecosystem.workflow_publications.withdrawn_at,
                    clock_timestamp()
                  )
     WHERE skipo_ecosystem.workflow_publications.publication_state='published'
  RETURNING id
), published AS (
  INSERT INTO skipo_ecosystem.workflow_publications
    (app_id,owner_user_id,workspace_id,workflow_id,version,display_name,description,publication_state)
  SELECT $1,$2,$3,$4,$5,$6,$7,'published'
   WHERE $8::text='published'
     -- Never replay an older version after a newer one has been observed.
     AND NOT EXISTS (
       SELECT 1 FROM skipo_ecosystem.workflow_publications newer
        WHERE newer.app_id=$1 AND newer.owner_user_id=$2 AND newer.workspace_id=$3
          AND newer.workflow_id=$4 AND newer.version>$5::integer
     )
  -- Publication identity, description, timestamps and withdrawal are immutable.
  -- An old withdrawn version can never be reactivated by a delayed retry.
  ON CONFLICT (app_id,owner_user_id,workspace_id,workflow_id,version)
    DO NOTHING
  RETURNING id
)
SELECT (SELECT count(*) FROM withdrawn) AS withdrawn_count,
       (SELECT count(*) FROM withdrawal_marker) AS tombstone_count,
       (SELECT count(*) FROM published) AS published_count`;
      await query(sql,[
        d.appId,d.ownerUserId,d.workspaceId,d.workflowId,d.version,
        d.displayName,d.description??null,d.state,
      ]);
    },
  };
}
