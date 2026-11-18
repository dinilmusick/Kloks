import { afterEach, describe, expect, it, vi } from 'vitest';
import { performInference } from './inferenceExecutor.js';

afterEach(() => vi.unstubAllGlobals());

describe('AI inference credential and provider boundaries', () => {
  it('never sends a credential to Groq for an unknown or unsupported provider', async () => {
    const send = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', send);
    for (const id of ['unrecognized-provider', 'openai', 'anthropic', '__proto__', 'constructor']) {
      await expect(performInference(id, 'model', 'foreign-provider-secret', 'hello'))
        .rejects.toThrow('Unsupported AI inference provider: ' + id);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it('sends Google credentials only as a header, not in the URL or payload', async () => {
    const send = vi.fn<typeof fetch>(async () => Response.json({
      candidates: [{ content: { parts: [{ text: 'generated text' }] } }],
    }));
    vi.stubGlobal('fetch', send);
    const result = await performInference('google', 'models/gemini-2.5-flash', '  google-secret  ', 'prompt');
    expect(result.text).toBe('generated text');
    expect(send).toHaveBeenCalledTimes(1);
    const [target, options] = send.mock.calls[0];
    const url = new URL(String(target));
    expect(url.origin).toBe('https://generativelanguage.googleapis.com');
    expect(url.pathname).toBe('/v1beta/models/gemini-2.5-flash:generateContent');
    expect(url.search).toBe('');
    const headers = new Headers(options?.headers);
    expect(headers.get('x-goog-api-key')).toBe('google-secret');
    expect(headers.get('authorization')).toBeNull();
    expect(String(options?.body)).not.toContain('google-secret');
  });

  it('rejects blank Google credentials without contacting the provider', async () => {
    const send = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', send);
    await expect(performInference('google', 'gemini-2.5-flash', '   ', 'prompt'))
      .rejects.toThrow('Missing API key');
    expect(send).not.toHaveBeenCalled();
  });

  it('preserves a valid Groq endpoint and bearer credential', async () => {
    const send = vi.fn<typeof fetch>(async () => Response.json({
      choices: [{ message: { content: 'ok' } }],
    }));
    vi.stubGlobal('fetch', send);
    const result = await performInference('groq', 'llama-3.3', 'groq-secret', 'prompt');
    expect(result.text).toBe('ok');
    expect(String(send.mock.calls[0][0])).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(new Headers(send.mock.calls[0][1]?.headers).get('authorization')).toBe('Bearer groq-secret');
  });
});
