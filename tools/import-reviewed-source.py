"""Reconstruct the reviewed public Mac source snapshot in a new directory.

No application code is executed. The source ZIP must match the published hash.
Only private Library/run identifiers in VALIDATION.json are omitted.
"""
from pathlib import Path, PurePosixPath
import argparse
import hashlib
import io
import json
import re
import stat
import urllib.request
import zipfile

SOURCE_URL = 'https://github.com/yeon971105/Mulow/releases/download/v7.0.7-mac-preview/Mulow-Mac-v7.0.7-Agent-source-2026-11-04.zip'
SOURCE_SHA256 = '45fab1c7c40ab609710889d106908e88df7e87d5e12dba3c69dea73efb7c80a7'
PRIVATE_KEYS = ('sourceLibraryId', 'realAgentRun', 'realBuildRun')
PUBLIC_NOTE = 'Library and top-level verification-run identifiers are omitted from this validation summary. Fixture data, validation scope and limitations are preserved.'
IGNORE = 'dist/\n.env*\n.DS_Store\nnode_modules/\ndata/\nsessions/\nlogs/\n*.sqlite\n*.db\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path)
    parser.add_argument('--destination', type=Path, default=Path('app'))
    parser.add_argument('--manifest', type=Path, default=Path('docs/source-manifest.json'))
    args = parser.parse_args()
    if args.destination.exists():
        raise SystemExit('Refusing to overwrite an existing source directory.')
    data = args.archive.read_bytes() if args.archive else urllib.request.urlopen(SOURCE_URL, timeout=60).read()
    if hashlib.sha256(data).hexdigest() != SOURCE_SHA256:
        raise SystemExit('Source ZIP hash mismatch.')
    entries = []
    patterns = [r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----', r'(?:AKIA|ASIA)[A-Z0-9]{16}', r'gh[pousr]_[A-Za-z0-9]{30,}', r'github_pat_[A-Za-z0-9_]{40,}', r'sk-(?:proj-)?[A-Za-z0-9_-]{32,}']
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        if archive.testzip() is not None:
            raise SystemExit('Source ZIP CRC failure.')
        for item in archive.infolist():
            name = PurePosixPath(item.filename)
            if name.is_absolute() or '..' in name.parts or not name.parts or name.parts[0] != 'source' or stat.S_ISLNK(item.external_attr >> 16):
                raise SystemExit('Unsafe source ZIP entry.')
            if item.is_dir():
                continue
            relative = PurePosixPath(*name.parts[1:])
            if not relative.parts or any(part in {'.git', '.env', '.ssh', '.aws', '.DS_Store'} for part in relative.parts):
                raise SystemExit('Private or invalid source entry.')
            content = archive.read(item)
            try:
                text = content.decode('utf-8')
            except UnicodeDecodeError:
                text = ''
            if any(re.search(pattern, text) for pattern in patterns):
                raise SystemExit('Credential-pattern finding in source entry: ' + str(relative))
            if str(relative) == 'VALIDATION.json':
                value = json.loads(text)
                for key in PRIVATE_KEYS:
                    value.pop(key, None)
                value['publicMetadataNote'] = PUBLIC_NOTE
                content = (json.dumps(value, indent=2) + '\n').encode()
            entries.append((str(relative), content, 0o755 if (item.external_attr >> 16) & 0o111 else 0o644))
    if len(entries) != 616:
        raise SystemExit('Unexpected source file count.')
    entries.append(('.gitignore', IGNORE.encode(), 0o644))
    hashes = {}
    args.destination.mkdir(parents=True)
    for relative, content, mode in entries:
        target = args.destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
        target.chmod(mode)
        hashes[relative] = {'sha256': hashlib.sha256(content).hexdigest(), 'gitBlobSHA1': hashlib.sha1(b'blob ' + str(len(content)).encode() + b'\0' + content).hexdigest(), 'bytes': len(content)}
    manifest = {'sourceURL': SOURCE_URL, 'sourceSHA256': SOURCE_SHA256, 'sourceFileCount': 616, 'repositoryFileCount': len(entries), 'changesFromArchive': ['Private Library and run identifiers omitted from VALIDATION.json.', 'Added .gitignore for local build output and private data.'], 'files': hashes}
    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    args.manifest.write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps({'sourceSHA256': SOURCE_SHA256, 'publishedFileCount': len(entries), 'credentialPatternFindings': 0}))


if __name__ == '__main__':
    main()
