---
"@ultrst-armada/kloks": patch
---

Remove the Cloudflare-to-SRKL fallback that forwarded raw provider tokens in query strings, expose WebContainer server-ready lifecycle through the canonical service, replace local auth/session storage with the Luth-backed compatibility client, and load storage-provider accounts from SRKL without persisting credentials in browser storage.
