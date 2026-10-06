import { cp, mkdir, rm } from 'node:fs/promises';
await rm('dist-extension', { recursive: true, force: true });
await mkdir('dist-extension', { recursive: true });
for (const name of ['manifest.json', 'background.js', 'content.js']) {
  await cp(`extension/${name}`, `dist-extension/${name}`);
}
console.log('Load dist-extension as an unpacked extension, then install the native helper (README.md).');
