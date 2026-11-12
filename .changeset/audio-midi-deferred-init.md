---
"@kloks/audio-midi": patch
---

Defer browser hardware access and state-graph bridge wiring until explicit audio/MIDI service initialization, keeping module imports safe in non-browser runtimes.
