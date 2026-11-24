import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const checkInterval = 30_000;
const recoveryWindow = 5 * 60_000;
const child = spawn(process.execPath, [fileURLToPath(new URL('./index.js', import.meta.url))], {
  stdio: 'inherit'
});
const healthUrl = 'http://127.0.0.1:' + (process.env.PORT || 3000) + '/live';
let lastHealthy = Date.now();
let stopping = false;

function stop(signal) {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  child.kill(signal);
  setTimeout(() => child.kill('SIGKILL'), 10_000).unref();
}

const timer = setInterval(async () => {
  try {
    const response = await fetch(healthUrl, {signal: AbortSignal.timeout(5000)});
    if (response.ok) lastHealthy = Date.now();
    await response.body?.cancel();
  } catch {
    // Network failures and a blocked event loop both count as failed probes.
  }
  if (!stopping && Date.now() - lastHealthy >= recoveryWindow) {
    console.error('Bot unresponsive, requesting automatic restart');
    stop('SIGTERM');
  }
}, checkInterval);

child.once('error', error => { console.error('Bot startup failed', error.message); process.exit(1); });
child.once('exit', code => process.exit(code ?? 1));
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
