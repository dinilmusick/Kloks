---
"@ultrst-armada/kloks": major
"@kloks/backend": major
---

**Breaking:** Google Drive's legacy Node SDK adapter and OAuth exports have been removed. Use the Fetch-native `GoogleDriveWorkspaceService` from `@ultrst-armada/kloks/backend/storage-workspace`; Node storage factories delegate to that service. The optional `googleapis` peer is no longer required by Kloks.
