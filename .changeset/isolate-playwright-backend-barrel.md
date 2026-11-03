---
"@ultrst-armada/kloks": patch
---

Keep Node-only Playwright inspection services out of the default backend export so Workers bundles can consume the backend without Node module loading.
