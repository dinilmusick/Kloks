import { SkipoBase } from '@kloks/functions/base';
import type { OfficialLuthUser } from '../auth/LuthOAuthUserInfo.js';
export interface OAuthResourceVerifier {
  verifyAccessToken(token: string): Promise<OfficialLuthUser | null>;
}
import { AuditLogger } from './AuditLogger.js';
import { DatabaseClusterManager } from './DatabaseClusterManager.js';

export class ControlPlaneManager extends SkipoBase {
  public auth: OAuthResourceVerifier;
  public audit: AuditLogger;
  public cluster: DatabaseClusterManager;

  constructor(auth: OAuthResourceVerifier, audit: AuditLogger, cluster: DatabaseClusterManager) {
    super();
    this.auth = auth;
    this.audit = audit;
    this.cluster = cluster;
  }
}
