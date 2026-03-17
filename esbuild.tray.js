const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const production = process.argv.includes('--production');

async function main() {
  await esbuild.build({
    entryPoints: ['src/tray/main.ts'],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    outfile: 'dist/tray.js',
    external: ['electron', 'pngjs', 'ws'],
    minify: production,
    sourcemap: !production,
  });

  // Copy tray icons to dist/
  for (const name of ['iconTemplate.png', 'iconTemplate@2x.png', 'appIcon.png', 'appIcon.icns']) {
    const src = path.join(__dirname, 'src', 'tray', name);
    const dst = path.join(__dirname, 'dist', name);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dst);
    }
  }

  console.log('✓ Tray bundle built → dist/tray.js');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
