# Listen al Gaib
> yes, you are obligated to read Dune on this.

A simple EPUB reader with WASM or native GPU text-to-speech. Runs in your browser. No login.

![Reader in AMOLED mode](docs/screenshots/reader-amoled.png)

## Features

- Read DRM-free EPUBs or listen with six English Kokoro voices.
- Generate speech with WASM, your own server, or a local GPU server managed by the desktop extension.
- Change playback speed, replay a passage, or skip forward and back.
- Import multiple books, search your library, and save reading progress.
- Navigate chapters and search inside a book.
- AMOLED by default, with light and dark modes, custom accent colors, and typography settings.
- Browse illustrations in a gallery or open them full screen with zoom and pan.
- Works on desktop and mobile.

## Appearance

![Theme, accent color, and text settings](docs/screenshots/appearance.png)

## Illustrations

![Full-screen illustration viewer](docs/screenshots/illustration-viewer.png)

## Local storage and narration

Books and progress stay in your browser. WASM narration runs on your CPU. Native GPU narration runs on your computer through the companion extension and helper. If you choose **Your server**, narrated passages are sent to the server URL you provide.

Voices need an initial download. Cached voice files and app resources can be reused offline. Books do not sync between devices. Clearing site data removes your saved library and progress.

To try the bundled sample, open **My library → Read the Alice sample**.

## Native GPU extension

The reader remains a website. The Manifest V3 companion extension starts a loopback speech server through an installed native messaging helper. Kokoro runs in Python/PyTorch using CUDA, ROCm (through PyTorch’s CUDA API), or Apple Metal. It never uses WebGPU. If no supported GPU is available, it reports an error instead of silently falling back to CPU.

The extension owns one server per requesting tab. Pressing Play in **Native GPU** starts it. Switching tabs, pausing, reloading, navigating within the reader, and choosing another backend leave it running. **Only closing that tab shuts down its server** during normal use. Closing the browser or disabling/reloading the extension also disconnects the helper. Closing a tab during model startup terminates the helper too. Multiple reader tabs have separate server processes and GPU allocations.

### Setup

1. Run `npm ci` and `npm run build:extension`.
2. In Chrome, Chromium, Edge, or Brave, open the extensions page, enable developer mode, and load the `dist-extension` folder as an unpacked extension. The bundled public key gives it a stable extension ID, so helper registration does not depend on the folder path.
3. Install Python 3.10–3.12 and create a virtual environment in this project:

   ```sh
   python3.12 -m venv .venv
   .venv/bin/python -m pip install --upgrade pip
   ```

4. Install the PyTorch build appropriate to your GPU and operating system using the [official PyTorch installer](https://pytorch.org/get-started/locally/). Use the virtual environment’s Python for the install command. Then install the speech dependencies:

   ```sh
   .venv/bin/python -m pip install -r native-host/requirements.txt
   ```

   Kokoro’s English language model may be downloaded on first use. If your platform requires `espeak-ng`, install it with your operating system’s package manager.

5. Register the helper using that same Python environment:

   ```sh
   .venv/bin/python native-host/install.py --browser chrome
   ```

   For a separately keyed extension, pass its extension ID as a positional argument. Other `--browser` values: `chromium`, `edge`, `brave`. On Windows, replace `.venv/bin/python` with `.venv\Scripts\python.exe`; registration uses the current user’s registry. Linux and macOS registration writes the selected browser’s user-level native messaging manifest. Keep the project and virtual environment at their installed paths, or rerun registration after moving them.

6. Reload the extension and the reader website. Open **Voice settings → Native GPU**, then press Play. The first launch downloads model weights and voices; later launches reuse the Python/Hugging Face cache. Chrome may require restarting after registering a native messaging host.

The extension is configured for `https://brahmkshatriya.github.io/listen-al-gaib/`, the former `/reader/` site, `http://localhost` and `http://127.0.0.1` development URLs. For a different deployment, update both `extension/manifest.json` content-script matches and the trusted URL check in `extension/background.js`, rebuild, and reload the extension.

The server binds only to `127.0.0.1` on a randomly assigned port, authenticates requests with a per-process secret, and is reached through the extension. The website does not need CORS or local network access permission for this managed server. The native messaging manifest allows only the extension ID you registered. No GPU model or runtime ships inside the extension.

### Without an extension

**Voice settings** always offers **WASM** and **Your server**, including mobile browsers. WASM requires no server or helper. For **Your server**, supply a Kokoro server’s base URL (for example `http://localhost:8880`), `/v1` URL, or full `/v1/audio/speech` endpoint. The reader sends:

```json
{"model":"kokoro","input":"Text to narrate","voice":"af_heart","response_format":"wav","speed":1}
```

The server must return uncompressed PCM or float WAV and allow the reader’s origin through CORS. An HTTPS reader needs a server URL permitted by the browser’s HTTPS and local-network rules. Playback speed is applied by the reader. Custom servers are user-managed; the extension only starts and stops its own helper server. Authenticated custom endpoints requiring API keys are not yet supported.

### Development checks

```sh
npm test
npm run build
npm run build:extension
```

Tests cover speech URLs, WAV decoding, request cancellation, trusted-site access, server reuse on reload, isolation between tabs, and helper shutdown on tab closure (including during startup). GPU/model inference requires testing on a machine with the helper’s dependencies and a supported GPU.

## Shortcuts

| Key | Action |
| --- | --- |
| Space | Play / pause |
| ← / → | Previous / next passage |
| C | Contents |
| I | Illustrations |
| Esc | Close panel or viewer |

## Credits

Narration: Kokoro. Alice sample: public-domain text and illustrations from Project Gutenberg. [Sample sources](public/demo/SOURCES.txt) · [Voice portrait sources](public/voices/SOURCES.json)
