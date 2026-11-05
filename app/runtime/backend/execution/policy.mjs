// No provider, shell, network, credential or user-repository access in this module.
export const LIMITS = Object.freeze({maxAttempts: 3, maxFiles: 200, maxBytes: 1_000_000, maxTimeoutMs: 120_000});

export function relativePath(value) {
  if (typeof value !== 'string' || value.length > 240 || !value || value.includes('\\') || value.includes(':') || /[\x00-\x1f\x7f]/.test(value)) throw Error('unsafe_path');
  const parts = value.split('/');
  if (parts.some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p))) throw Error('unsafe_path');
  if (parts.some(p => /^(\.git|\.env(?:\..*)?|\.ssh|\.aws|\.local-data|node_modules)$/i.test(p)) || /\.(pem|key|p12|pfx)$/i.test(value)) throw Error('sensitive_path');
  return value;
}

export function freezeFiles(entries) {
  if (!Array.isArray(entries) || entries.length > LIMITS.maxFiles) throw Error('file_limit');
  const names = new Set(); let bytes = 0;
  const result = entries.map(entry => {
    const path = relativePath(entry.path);
    if (typeof entry.content !== 'string' || entry.kind && entry.kind !== 'file') throw Error('regular_text_files_only');
    const key = path.normalize('NFC').toLowerCase();
    if (names.has(key) || [...names].some(n => n.startsWith(key + '/') || key.startsWith(n + '/'))) throw Error('path_collision');
    names.add(key); bytes += Buffer.byteLength(entry.content);
    if (bytes > LIMITS.maxBytes) throw Error('byte_limit');
    return Object.freeze({path, content: entry.content});
  });
  return Object.freeze(result);
}

export function applyChanges(baseline, changes) {
  if (!Array.isArray(changes) || changes.length > LIMITS.maxFiles) throw Error('change_limit');
  const files = new Map(baseline.map(x => [x.path, x.content]));
  const seen = new Set();
  for (const change of changes) {
    const path = relativePath(change.path);
    if (seen.has(path)) throw Error('duplicate_change');
    seen.add(path);
    if (change.operation === 'delete') files.delete(path);
    else if (change.operation === 'write' && typeof change.content === 'string') files.set(path, change.content);
    else throw Error('invalid_change');
  }
  return freezeFiles([...files].map(([path, content]) => ({path, content})));
}

// Command metadata comes from application-owned configuration, NEVER imported README/package scripts.
export function selectCommands(ids, allowlist) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 8 || new Set(ids).size !== ids.length) throw Error('invalid_commands');
  return Object.freeze(ids.map(id => {
    if (typeof id !== 'string' || !Object.hasOwn(allowlist, id)) throw Error('command_not_allowed');
    const c = allowlist[id];
    if (!c || typeof c.executable !== 'string' || !c.executable || !Array.isArray(c.args) || c.args.some(a => typeof a !== 'string') || c.shell !== false || c.network !== false) throw Error('unsafe_command_configuration');
    return Object.freeze({id, executable: c.executable, args: Object.freeze([...c.args]), shell: false, network: false});
  }));
}
