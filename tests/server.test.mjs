import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
const source = await readFile(new URL('../src/tts/server.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { speechEndpoint, decodeWav, ServerTtsEngine } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
function wav(samples, channels = 1) {
  const bytes = new ArrayBuffer(44 + samples.length * 2), view = new DataView(bytes);
  const tag = (offset, text) => [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  tag(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); tag(8, 'WAVE'); tag(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, 24000, true); view.setUint32(28, 24000 * channels * 2, true);
  view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); tag(36, 'data');
  view.setUint32(40, samples.length * 2, true); samples.forEach((s, i) => view.setInt16(44 + i * 2, s, true));
  return bytes;
}
test('speech endpoint accepts bases and exact endpoints; rejects unsafe/invalid URLs', () => {
  for (const input of ['http://localhost:8880', 'http://localhost:8880/v1/', 'http://localhost:8880/v1/audio/speech']) {
    assert.equal(speechEndpoint(input).href, 'http://localhost:8880/v1/audio/speech');
  }
  assert.equal(speechEndpoint('https://speech.example/api').pathname, '/api/v1/audio/speech');
  for (const input of ['', 'file:///tmp/server', 'https://user:pass@host', 'https://host/?secret=x']) assert.throws(() => speechEndpoint(input));
});
test('PCM WAV decodes and stereo is mixed to mono', () => {
  const result = decodeWav(wav([-32768, 0, 16384]));
  assert.equal(result.sampleRate, 24000); assert.deepEqual([...result.data], [-1, 0, .5]);
  assert.deepEqual([...decodeWav(wav([-16384, 16384, 8192, 8192], 2)).data], [0, .25]);
  assert.throws(() => decodeWav(new ArrayBuffer(4)));
  assert.throws(() => decodeWav(wav([1]).slice(0, 45)));
});
test('server sends Kokoro WAV request and cancellation drops queued requests', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => { calls.push([url.href, JSON.parse(options.body)]); return new Response(wav([0, 100])); };
  try {
    const engine = new ServerTtsEngine('http://localhost:8880', () => {});
    await engine.loadVoice('bf_emma');
    await engine.synthesize('Hello');
    assert.deepEqual(calls[0], ['http://localhost:8880/v1/audio/speech', { model: 'kokoro', input: 'Hello', voice: 'bf_emma', response_format: 'wav', speed: 1 }]);
    const queued = engine.synthesize('Cancelled'); engine.cancel();
    await assert.rejects(queued, { name: 'AbortError' }); assert.equal(calls.length, 1);
  } finally { globalThis.fetch = original; }
});
