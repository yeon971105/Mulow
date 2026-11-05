// Application-owned offline fixture, not a user project test or generated program.
import {readFile} from 'node:fs/promises';
try { process.exitCode = await readFile('result.txt', 'utf8') === 'pass\n' ? 0 : 1; }
catch { process.exitCode = 1; }
