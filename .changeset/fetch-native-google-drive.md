---
"@ultrst-armada/kloks": major
"@kloks/backend": major
---

**Breaking:** Kloks' legacy Node Google Drive adapter and OAuth exports have been removed. Use the Fetch-native `GoogleDriveWorkspaceService` from `@ultrst-armada/kloks/backend/storage-workspace`; Node storage factories delegate to that service. Kloks no longer declares `googleapis` as a peer dependency. GutTS retains its own optional `googleapis` peer solely for the separate aggregate Node Google Drive integration; neither the GutTS S3-only subpath nor Kloks' Fetch-native Drive entrypoint requires it.
