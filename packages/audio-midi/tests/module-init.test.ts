import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('audio/MIDI module initialization boundary', () => {
  it('loads and constructs managers without browser globals', async () => {
    for (const key of ['window', 'document', 'localStorage', 'navigator', 'AudioContext']) {
      vi.stubGlobal(key, undefined);
    }

    const audioMidi = await import('../src/index.js');
    expect(audioMidi.AudioHardwareServiceDefinition).toBeDefined();
    expect(audioMidi.MidiServiceDefinition).toBeDefined();

    const audio = new audioMidi.AudioInputManager();
    const midi = new audioMidi.MidiManager();

    expect(audio.getState().isInitialized).toBe(false);
    expect(midi.getState().isInitialized).toBe(false);

    await audio.dispose();
    await midi.dispose();
  });
});
