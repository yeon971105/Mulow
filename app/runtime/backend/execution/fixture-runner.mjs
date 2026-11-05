// OFFLINE FIXTURE ONLY. This trusted verifier reads a text file; it never executes generated code.
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const verifier = fileURLToPath(new URL('./fixture-verifier.mjs', import.meta.url));
export const fixtureAllowlist = Object.freeze({
  'fixture:text': Object.freeze({executable: process.execPath, args: Object.freeze([verifier]), shell: false, network: false})
});
export function createOfflineFixtureRunner() {
  const running = new Set();
  const pending = new Set();
  return {
    test({cwd, commands, signal}) {
      if (commands.length !== 1 || commands[0].id !== 'fixture:text' || commands[0].executable !== process.execPath || commands[0].args.length !== 1 || commands[0].args[0] !== verifier) throw Error('fixture_command_only');
      if (signal.aborted) throw Error('cancelled');
      let child;
      const promise = new Promise((resolve, reject) => {
        child = spawn(process.execPath, [verifier], {cwd, shell: false, env: {}, stdio: 'ignore'});
        running.add(child);
        const abort = () => child.kill('SIGKILL');
        signal.addEventListener('abort', abort, {once: true});
        let spawnError;
        child.once('error', error => { spawnError = error; });
        child.once('close', code => {
          running.delete(child); signal.removeEventListener('abort', abort);
          if (spawnError) reject(spawnError); else resolve({passed: code === 0});
        });
      });
      pending.add(promise);
      promise.then(() => pending.delete(promise), () => pending.delete(promise));
      return promise;
    },
    async stopAndWait() {
      for (const child of running) child.kill('SIGKILL');
      await Promise.allSettled([...pending]);
    }
  };
}
