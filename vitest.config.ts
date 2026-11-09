import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    server: {
      deps: {
        // Keep the published GutTS ESM entry in Vite's module graph so vi.mock
        // in the storage tests intercepts its Google SDK export deterministically.
        inline: [/@dinilmusick\\+gutts@/, /@dinilmusick[\\/]gutts[\\/]/],
      },
    },
  },
  resolve: {
    alias: {
      '@kloks/functions': path.resolve(__dirname, 'packages/functions/dist/index.js'),
      '@kloks/state-graph': path.resolve(__dirname, 'packages/state-graph/dist/index.js'),
      '@kloks/audio-midi': path.resolve(__dirname, 'packages/audio-midi/dist/index.js'),
      '@kloks/services': path.resolve(__dirname, 'packages/services/dist/index.js'),
      '@kloks/backend': path.resolve(__dirname, 'packages/backend/dist/index.js'),
      '@kloks/orchestrations': path.resolve(__dirname, 'packages/orchestrations/dist/index.js'),
      '@kloks/contracts': path.resolve(__dirname, 'packages/contracts/dist/index.js'),
      '@ultrst-armada/kloks/functions': path.resolve(__dirname, 'packages/functions/dist/index.js'),
      '@ultrst-armada/kloks/state-graph': path.resolve(__dirname, 'packages/state-graph/dist/index.js'),
      '@ultrst-armada/kloks/audio-midi/services': path.resolve(__dirname, 'packages/audio-midi/dist/services/index.js'),
      '@ultrst-armada/kloks/audio-midi': path.resolve(__dirname, 'packages/audio-midi/dist/index.js'),
      '@ultrst-armada/kloks/clock': path.resolve(__dirname, 'packages/audio-midi/dist/clock/index.js'),
      '@ultrst-armada/kloks/midi': path.resolve(__dirname, 'packages/audio-midi/dist/midi/index.js'),
      '@ultrst-armada/kloks/osc/node': path.resolve(__dirname, 'packages/audio-midi/dist/osc/node-udp.js'),
      '@ultrst-armada/kloks/osc': path.resolve(__dirname, 'packages/audio-midi/dist/osc/index.js'),
      '@ultrst-armada/kloks/services': path.resolve(__dirname, 'packages/services/dist/index.js'),
      '@ultrst-armada/kloks/backend': path.resolve(__dirname, 'packages/backend/dist/index.js'),
      '@ultrst-armada/kloks/orchestrations': path.resolve(__dirname, 'packages/orchestrations/dist/index.js'),
      '@ultrst-armada/kloks/contracts': path.resolve(__dirname, 'packages/contracts/dist/index.js'),
    },
  },
});
