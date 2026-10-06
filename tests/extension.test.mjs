import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const source = await readFile(new URL('../extension/background.js', import.meta.url), 'utf8');
function setup() {
  const callbacks = {}, ports = [];
  const chrome = {
    runtime: { onMessage: { addListener: fn => callbacks.message = fn }, connectNative: () => {
      const events = {};
      const port = { closed: false, onMessage: { addListener: fn => events.message = fn }, onDisconnect: { addListener: fn => events.disconnect = fn },
        disconnect() { this.closed = true; events.disconnect(); },
        postMessage() { queueMicrotask(() => { if (!this.closed) events.message({ url: 'http://127.0.0.1:12345', token: 'test', device: 'Native GPU' }); }); },
      }; ports.push(port); return port;
    } },
    tabs: { onRemoved: { addListener: fn => callbacks.removed = fn }, create() {} },
    action: { onClicked: { addListener: fn => callbacks.click = fn } },
  };
  vm.runInNewContext(source, { chrome, URL, setTimeout, clearTimeout, AbortController, fetch, btoa });
  const send = (id, type = 'start', url = 'https://brahmkshatriya.github.io/reader/') => new Promise(resolve => {
    const handled = callbacks.message({ type }, { tab: { id }, frameId: 0, url }, resolve);
    if (!handled) resolve({ rejected: true });
  });
  return { callbacks, ports, send };
}
test('reload reuses the same server and only the owning tab closing disconnects it', async () => {
  const { callbacks, ports, send } = setup();
  assert.equal((await send(1)).device, 'Native GPU');
  await send(1); assert.equal(ports.length, 1);
  await send(2); assert.equal(ports.length, 2);
  callbacks.removed(3); assert.equal(ports[0].closed, false);
  callbacks.removed(1); assert.equal(ports[0].closed, true); assert.equal(ports[1].closed, false);
  callbacks.removed(2); assert.equal(ports[1].closed, true);
});
test('detection does not start a server and untrusted sites cannot start one', async () => {
  const { send, ports } = setup();
  assert.equal((await send(1, 'ping')).available, true); assert.equal(ports.length, 0);
  assert.equal((await send(1, 'start', 'https://example.com')).rejected, true);
  assert.equal(ports.length, 0);
});

test('closing the owning tab during startup cancels its pending launch', async () => {
  const { callbacks, ports, send } = setup();
  const starting = send(1);
  callbacks.removed(1);
  assert.equal(ports[0].closed, true);
  assert.match((await starting).error, /helper/);
  await send(1); assert.equal(ports.length, 2);
  callbacks.removed(1);
});
