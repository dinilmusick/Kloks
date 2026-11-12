---
"@ultrst-armada/kloks": major
"@kloks/backend": major
---

**Breaking:** Kloks' legacy Node Google Drive adapter and OAuth exports have been removed. Use the Fetch-native `GoogleDriveWorkspaceService` from `@ultrst-armada/kloks/backend/storage-workspace`; Node storage factories delegate to that service. The optional `googleapis` peer remains for GutTS's separately owned Node Google Drive integration, which is still reachable from Kloks' Node backend entrypoint; it is not part of the portable backend or Fetch-native Drive dependency closure.
