"""Explicit Windows setup, or exact-item reuse through an anonymous stdin pipe."""
import argparse
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
from windows_credentials import CredentialError, WindowsVault, secure_setup, validate_secret, wipe

ROOT = Path(__file__).resolve().parent.parent


class PrivateParser(argparse.ArgumentParser):
    def error(self, _message):
        self.exit(2, 'Invalid launcher arguments. Never put an API key in command arguments.\n')


def launch_saved(vault, node, data_directory, port, spawn=subprocess.Popen):
    # An allowlist avoids inheriting unrelated credentials or Node preload options.
    allowed = ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA']
    environment = {k: os.environ[k] for k in allowed if k in os.environ}
    argv = [str(node), str(ROOT / 'scripts/start-windows-credential.mjs'),
            '--credential-pipe-v1', str(data_directory), str(port)]
    secret = None
    child = None
    try:
        secret = vault.read()
        validate_secret(secret)
        child = spawn(argv, cwd=ROOT, env=environment, stdin=subprocess.PIPE)
        try:
            child.stdin.write(struct.pack('>I', len(secret)))
            child.stdin.write(secret)
            child.stdin.close()
        except (OSError, ValueError):
            child.terminate()
            child.wait()
            raise CredentialError('The local credential pipe did not complete. No retry was started.') from None
    finally:
        wipe(secret)
    return child.wait()


def main(argv=None):
    parser = PrivateParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--setup', action='store_true')
    mode.add_argument('--launch', action='store_true')
    mode.add_argument('--status', action='store_true')
    parser.add_argument('--data-directory', type=Path)
    parser.add_argument('--port', type=int, default=4173)
    args = parser.parse_args(argv)
    if sys.platform != 'win32':
        raise CredentialError('This launcher requires Windows.')
    if not 1024 <= args.port <= 65535 or args.setup and args.data_directory is not None:
        raise CredentialError('Invalid local launcher configuration.')
    if args.status:
        print(json.dumps({'stored': WindowsVault().exists(), 'metadataOnly': True, 'providerCalls': 0}), flush=True)
        return 0
    if args.setup:
        print(json.dumps(secure_setup(WindowsVault())), flush=True)
        return 0
    if args.data_directory is None or not args.data_directory.is_absolute() or not args.data_directory.is_dir():
        raise CredentialError('Choose the existing absolute Mulow data directory explicitly.')
    node = shutil.which('node')
    if not node:
        raise CredentialError('The existing Node runtime is unavailable. Nothing was installed.')
    return launch_saved(WindowsVault(), node, args.data_directory.resolve(), args.port)


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except CredentialError as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2)
    except (KeyboardInterrupt, EOFError):
        print('Mulow stopped. No credential was printed.', file=sys.stderr)
        raise SystemExit(2)
    except Exception:
        # Never print arbitrary OS/subprocess/transport objects or stack traces.
        print('Windows credential operation was not confirmed. No automatic retry.', file=sys.stderr)
        raise SystemExit(2)
