const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

function waitForServerReady(proc, timeoutMs = 90_000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    let seenReady = false;
    let output = '';

    const onData = (data) => {
      const text = data.toString();
      output += text;
      // Next.js dev server typically logs "ready" when it can accept traffic.
      if (!seenReady && /ready\s*-\s*started server|ready\s+on/i.test(text)) {
        seenReady = true;
        cleanup();
        resolve();
      }
    };

    const onExit = (code) => {
      if (!seenReady) {
        cleanup();
        reject(new Error(`Server exited early (code ${code}). Output:\n${output}`));
      }
    };

    const timer = setInterval(() => {
      if (seenReady) return;
      if (Date.now() - start > timeoutMs) {
        cleanup();
        reject(new Error(`Timed out waiting for server to be ready. Output:\n${output}`));
      }
    }, 250);

    function cleanup() {
      clearInterval(timer);
      proc.stdout?.off('data', onData);
      proc.stderr?.off('data', onData);
      proc.off('exit', onExit);
    }

    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);
    proc.on('exit', onExit);
  });
}

async function fetchText(url) {
  const res = await fetch(url, { redirect: 'manual' });
  const text = await res.text();
  return { status: res.status, text, headers: res.headers };
}

test('smoke: server renders login page and protected route shell loads', async () => {
  const port = 3100;
  const baseUrl = `http://127.0.0.1:${port}`;

  const env = {
    ...process.env,
    // Provide defaults so the app can boot for smoke testing.
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'test-anon-key',
    PORT: String(port)
  };

  const nextCli = path.resolve(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next');
  const proc = spawn(process.execPath, [nextCli, 'dev', '-p', String(port)], {
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await waitForServerReady(proc);

    const login = await fetchText(`${baseUrl}/login`);
    assert.equal(login.status, 200);
    assert.ok(login.text.includes('TrackFit'));
    assert.ok(login.text.includes('Email'));
    assert.ok(login.text.includes('Password'));

    const workoutStart = await fetchText(`${baseUrl}/workout/start`);
    assert.equal(workoutStart.status, 200);
    // Protected routes should still render shell; client-side auth will redirect.
    assert.ok(/Loading/i.test(workoutStart.text));

const coach = await fetchText(`${baseUrl}/coach`);
assert.equal(coach.status, 200);
// Coach route should exist and render shell; client-side auth will redirect if not authorized.
assert.ok(/Loading/i.test(coach.text));

  } finally {
    proc.kill('SIGTERM');
  }
});
