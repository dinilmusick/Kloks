# Cloud Run v2 service lifecycle for Frnes

Canonical backend provider client uses an IAM-scoped Google OAuth **access token**
for Cloud Run management. It is never sent to an arbitrary workload service.

- `getCloudRunService`: validated exact project/region/service and read-only
  provider-reported CPU, memory, readiness and scaling. Missing limits remain null.
- `createCloudRunService`: creates a container-backed service **only** with
  explicit `approveProvisioning:true`; user chooses image and resources.
- `setCloudRunManualInstances`: explicit manual zero to disable, or one to
  resume (one always-on instance can incur charges).
- `deleteCloudRunService`: irreversible delete with explicit approval.
- `getCloudRunOperation`: checks a full Google long-running operation name in
  exactly the same project/region. A failed operation never counts as success.

These are real Google Admin API REST methods, with mock transport tests, not
account-verified live provisioning. New services and paid manual scaling may incur
charges. This library does not auto-create or rotate Google accounts, schedule
agents, assume free-tier quota, or transfer management access tokens into
workload invocations.

Authenticating a Cloud Run **workload** separately requires a Google-signed
**ID token with correct audience** and Cloud Run Invoker IAM permission; a Google
OAuth access token is NOT a substitute. Workload routing and live IAM verification
are downstream work.

Official references:
- https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.services/create
- https://docs.cloud.google.com/run/docs/managing/services
- https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.services/delete
- https://docs.cloud.google.com/run/docs/authenticating/service-to-service
