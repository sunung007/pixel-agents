const { spawn } = require('child_process');
const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('child_process').ChildProcess | null} */
let serverProc = null;

function restartServer() {
  if (serverProc) {
    serverProc.kill('SIGTERM');
    serverProc = null;
  }
  serverProc = spawn('node', ['dist/server.js', '--no-open'], {
    stdio: 'inherit',
    cwd: __dirname,
  });
  serverProc.on('exit', (code) => {
    if (serverProc) {
      // Only log if we didn't intentionally kill it
      serverProc = null;
      if (code && code !== 0) {
        console.log(`[serve] server exited with code ${code}`);
      }
    }
  });
}

async function main() {
  if (watch) {
    const ctx = await esbuild.context({
      entryPoints: ['src/server/index.ts'],
      bundle: true,
      format: 'cjs',
      platform: 'node',
      target: 'node18',
      outfile: 'dist/server.js',
      external: ['pngjs', 'ws'],
      minify: false,
      sourcemap: true,
      banner: { js: '#!/usr/bin/env node' },
      plugins: [
        {
          name: 'restart-server',
          setup(build) {
            build.onStart(() => {
              console.log('[watch:server] rebuilding...');
            });
            build.onEnd((result) => {
              if (result.errors.length === 0) {
                console.log('[watch:server] build finished, restarting server');
                restartServer();
              } else {
                result.errors.forEach(({ text, location }) => {
                  console.error(`✘ [ERROR] ${text}`);
                  if (location) {
                    console.error(`    ${location.file}:${location.line}:${location.column}:`);
                  }
                });
              }
            });
          },
        },
      ],
    });
    await ctx.watch();
    console.log('[watch:server] watching for changes...');

    // Graceful shutdown
    process.on('SIGINT', async () => {
      if (serverProc) serverProc.kill('SIGTERM');
      await ctx.dispose();
      process.exit(0);
    });
  } else {
    await esbuild.build({
      entryPoints: ['src/server/index.ts'],
      bundle: true,
      format: 'cjs',
      platform: 'node',
      target: 'node18',
      outfile: 'dist/server.js',
      external: ['pngjs', 'ws'],
      minify: production,
      sourcemap: !production,
      banner: { js: '#!/usr/bin/env node' },
    });
    console.log('✓ Server bundle built → dist/server.js');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
