# Mulow for Mac

The tested v7.0.7 source with Agent continuation, dynamic workflow candidates,
automatic route selection, user Steer, actual node results and linked rewind.
The original Plan stays intact when Agent mode upgrades an existing project.

## Build

Use Apple Silicon macOS 15+, Xcode command line tools, Python 3 and the official
Node 24.8.0 darwin-arm64 distribution. No credential is required to compile.

```sh
python3 build-mac.py --node-directory /absolute/path/node-v24.8.0-darwin-arm64
```

This creates `dist/Mulow.app` and verifies an ad-hoc signature. It does not create
a Developer ID signature or notarization. Keep all third-party notices.

## Portable synthetic Agent QA subset

```sh
/absolute/path/node-v24.8.0-darwin-arm64/bin/node --test qa/*.test.mjs
```

These isolated tests use synthetic provider responses and temporary stores,
including one loopback HTTP fixture. They do not access a real key or production
user data. They are a subset of the recorded 114-check Mac validation run.
Real Muse and UI acceptance evidence is summarized in VALIDATION.json.

## License

Mulow's original code is MIT, copyright 2026 Jewon Yeon. Third-party copyrights
and licenses remain in THIRD_PARTY_NOTICES.txt and the vendored distributions.
The Node executable is omitted from this source archive and supplied by the
builder; NODE-LICENSE.txt is retained for the distribution inventory.
