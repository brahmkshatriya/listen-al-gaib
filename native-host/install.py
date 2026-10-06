#!/usr/bin/env python3
"""Register the helper for the supplied unpacked extension ID and Python environment."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import re
import shlex
import sys

parser = argparse.ArgumentParser()
parser.add_argument('extension_id', nargs='?', help='ID shown on chrome://extensions; defaults to the bundled extension ID')
parser.add_argument('--browser', choices=['chrome', 'chromium', 'edge', 'brave'], default='chrome')
args = parser.parse_args()
root = Path(__file__).resolve().parent
if args.extension_id is None:
    manifest = json.loads((root.parent / 'extension/manifest.json').read_text())
    digest = hashlib.sha256(base64.b64decode(manifest['key'])).hexdigest()[:32]
    args.extension_id = ''.join(chr(ord('a') + int(character, 16)) for character in digest)
if not re.fullmatch('[a-p]{32}', args.extension_id):
    parser.error('Extension ID must be the 32-letter ID shown by your browser')
name = 'com.listen_al_gaib.gpu'
if sys.platform == 'win32':
    launcher = root / 'launch.cmd'
    launcher.write_text(f'@echo off\n"{sys.executable}" "{root / "host.py"}" %*\n')
    manifest_path = root / f'{name}.json'
else:
    launcher = root / 'launch.sh'
    launcher.write_text(f'#!/bin/sh\nexec {shlex.quote(sys.executable)} {shlex.quote(str(root / "host.py"))} "$@"\n')
    launcher.chmod(0o700)
    if sys.platform == 'darwin':
        paths = {'chrome': 'Google/Chrome', 'chromium': 'Chromium', 'edge': 'Microsoft Edge', 'brave': 'BraveSoftware/Brave-Browser'}
        folder = Path.home() / 'Library/Application Support' / paths[args.browser]
    else:
        paths = {'chrome': 'google-chrome', 'chromium': 'chromium', 'edge': 'microsoft-edge', 'brave': 'BraveSoftware/Brave-Browser'}
        import os
        folder = Path(os.environ.get('XDG_CONFIG_HOME', str(Path.home() / '.config'))) / paths[args.browser]
    manifest_path = folder / 'NativeMessagingHosts' / f'{name}.json'
manifest_path.parent.mkdir(parents=True, exist_ok=True)
manifest_path.write_text(json.dumps({
    'name': name, 'description': 'Listen al Gaib local GPU server launcher',
    'path': str(launcher), 'type': 'stdio',
    'allowed_origins': [f'chrome-extension://{args.extension_id}/'],
}, indent=2))
if sys.platform == 'win32':
    import winreg
    keys = {'chrome': 'Google\\Chrome', 'chromium': 'Chromium', 'edge': 'Microsoft\\Edge', 'brave': 'BraveSoftware\\Brave-Browser'}
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, f'Software\\{keys[args.browser]}\\NativeMessagingHosts\\{name}') as key:
        winreg.SetValueEx(key, '', 0, winreg.REG_SZ, str(manifest_path))
print(f'Registered {manifest_path}\nPython: {sys.executable}\nReload the extension, then press Play.')
