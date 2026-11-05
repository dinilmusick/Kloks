---
"@ultrst-armada/kloks": patch
---

Remove the Cloudflare-to-SRKL fallback that forwarded raw provider tokens in query strings. Provider failures now return a sanitized error without disclosing credentials to another service.
