// Wrapper only. The adjacent upstream package files remain untouched.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const acorn = require('./acorn/dist/acorn.js');
const jsx = require('./acorn-jsx/index.js');
// Parser.acorn provides acorn-jsx its explicit peer; do not use jsx.tokTypes.
export const Parser = acorn.Parser.extend(jsx());
export const parse = (source, options = {}) => Parser.parse(source, {
  ecmaVersion: 'latest', sourceType: 'module', locations: true, ...options,
});
