# Isolated official parser vendor

Fetched official npm registry metadata and pinned `acorn@8.19.0` and
`acorn-jsx@5.3.2`. Isolated staging install used `--ignore-scripts --no-audit
--no-fund --save-exact`; package tarballs were obtained with `npm pack
--ignore-scripts`. The `acorn/` and `acorn-jsx/` directories are untouched
regular-file payloads extracted directly from those tarballs (not copied from
node_modules). Each includes its upstream MIT LICENSE.

`manifest.json` records official URLs, verified tarball SHA512 npm integrity,
tarball SHA256, and every upstream file's SHA256. `SHA256SUMS` covers all delivered
files except itself. `staging-package-lock.json` retains staging resolution.

Import from an ESM policy module one directory above:

```js
import { parse, Parser } from './vendor/jsx-parser.mjs';
const ast = parse(source);
```

The wrapper uses Node's createRequire with explicit relative package paths.
Acorn's `Parser.acorn` supplies acorn-jsx its peer parser, so no node_modules or
bare `acorn` resolution is needed. Do not access `jsx.tokTypes`: that optional
upstream getter performs a bare dependency lookup.

Verified under Node v24.22.1: valid React JSX parses to JSXElement, malformed JSX
throws SyntaxError. This parser does not execute submitted source, but it also
does not itself impose a security policy; the caller must validate the AST.
