import json
from pathlib import Path
import socket
import struct
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]

class NativeHostLifecycle(unittest.TestCase):
    def launch(self, slow=False):
        fixture = f'''
import sys, threading, time
sys.path.insert(0, {str(ROOT / 'native-host')!r})
import host
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
def start():
    {'time.sleep(30)' if slow else 'pass'}
    server = ThreadingHTTPServer(('127.0.0.1', 0), BaseHTTPRequestHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, {{'port': server.server_port}}
host.start_server = start
host.main()
'''
        process = subprocess.Popen([sys.executable, '-c', fixture], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.addCleanup(lambda: process.kill() if process.poll() is None else None)
        payload = json.dumps({'type': 'start'}).encode()
        process.stdin.write(struct.pack('=I', len(payload)) + payload); process.stdin.flush()
        return process

    def test_disconnect_stops_server_process(self):
        process = self.launch()
        length = struct.unpack('=I', process.stdout.read(4))[0]
        port = json.loads(process.stdout.read(length))['port']
        with socket.create_connection(('127.0.0.1', port), timeout=2):
            pass
        process.stdin.close()
        self.assertEqual(process.wait(timeout=5), 0)
        with self.assertRaises(OSError):
            socket.create_connection(('127.0.0.1', port), timeout=1)
        process.stdout.close(); process.stderr.close()

    def test_disconnect_during_startup_exits_without_waiting_for_model(self):
        process = self.launch(slow=True)
        process.stdin.close()
        self.assertEqual(process.wait(timeout=5), 0)
        process.stdout.close(); process.stderr.close()
