#!/usr/bin/env python3
"""Native messaging launcher. Owns the loopback GPU server until Chrome disconnects."""
import io
import json
import os
import secrets
import struct
import sys
import threading
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

WIRE_OUT = os.fdopen(os.dup(sys.stdout.fileno()), 'wb', buffering=0)
# Keep library logs and subprocess downloads off the native messaging pipe.
os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
sys.stdout = sys.stderr
VOICES = {'af_heart', 'af_bella', 'af_nicole', 'am_michael', 'bf_emma', 'bm_george'}


def read_message():
    header = sys.stdin.buffer.read(4)
    if not header:
        return None
    if len(header) != 4:
        raise ValueError('Truncated message header')
    length = struct.unpack('=I', header)[0]
    if length > 65536:
        raise ValueError('Message too large')
    payload = sys.stdin.buffer.read(length)
    if len(payload) != length:
        raise ValueError('Truncated message')
    return json.loads(payload)


def send_message(message):
    payload = json.dumps(message).encode()
    WIRE_OUT.write(struct.pack('=I', len(payload)) + payload)
    WIRE_OUT.flush()


def start_server():
    import torch
    from kokoro import KPipeline
    if torch.cuda.is_available():
        device = 'cuda'  # PyTorch ROCm also exposes this API.
        label = f'Native GPU · {torch.cuda.get_device_name(0)}'
    elif hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
        device, label = 'mps', 'Native GPU · Apple Metal'
    else:
        raise RuntimeError('No supported GPU found. Install a GPU-enabled PyTorch build and drivers, or choose your server or WASM.')
    pipeline = KPipeline(lang_code='a', repo_id='hexgrad/Kokoro-82M', device=device)
    british = KPipeline(lang_code='b', repo_id='hexgrad/Kokoro-82M', model=pipeline.model)
    token = secrets.token_urlsafe(32)
    lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_POST(self):
            if self.path != '/v1/audio/speech':
                self.send_error(404)
                return
            if self.headers.get('Authorization') != f'Bearer {token}':
                self.send_error(403)
                return
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 65536:
                    raise ValueError('Invalid request size')
                request = json.loads(self.rfile.read(length))
                text, voice = request.get('input'), request.get('voice', 'af_heart')
                if not isinstance(text, str) or not 0 < len(text) <= 12000 or voice not in VOICES:
                    raise ValueError('Invalid text or voice')
                if request.get('response_format', 'wav') != 'wav':
                    raise ValueError('Only WAV is supported')
                with lock, torch.inference_mode():
                    selected = british if voice.startswith('b') else pipeline
                    chunks = [audio.detach().cpu() for _, _, audio in selected(text, voice=voice, speed=1)]
                    if not chunks:
                        raise ValueError('No audio generated')
                    samples = torch.cat(chunks).clamp(-1, 1).mul(32767).to(torch.int16).numpy().astype('<i2').tobytes()
                output = io.BytesIO()
                with wave.open(output, 'wb') as wav:
                    wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(24000); wav.writeframes(samples)
                payload = output.getvalue()
                self.send_response(200)
                self.send_header('Content-Type', 'audio/wav')
                self.send_header('Content-Length', str(len(payload)))
                self.end_headers(); self.wfile.write(payload)
            except (BrokenPipeError, ConnectionResetError):
                pass
            except Exception as error:
                print(error, file=sys.stderr)
                self.send_error(400 if isinstance(error, ValueError) else 500, 'Speech generation failed')

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, {'url': f'http://127.0.0.1:{server.server_port}', 'token': token, 'device': label}


def main():
    server = None
    starting = False

    def initialize():
        nonlocal server
        try:
            server, response = start_server()
            send_message(response)
        except Exception as error:
            send_message({'error': str(error)})

    try:
        while (message := read_message()) is not None:
            if message.get('type') != 'start' or starting:
                send_message({'error': 'Unexpected native helper request'})
                continue
            starting = True
            # Keep reading the native pipe during downloads and initialization so closing
            # the tab can terminate even before the GPU/model is ready.
            threading.Thread(target=initialize, daemon=True).start()
    finally:
        if server:
            server.shutdown()
            server.server_close()
        # Stop in-flight inference/download threads and release the GPU immediately.
        os._exit(0)


if __name__ == '__main__':
    main()
