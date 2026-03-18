const path = require('path');
const fs = require('fs');
const { packager } = require('@electron/packager');

const projectRoot = path.resolve(__dirname, '..');
const distDir = path.join(projectRoot, 'dist');

// Write a minimal package.json for Electron packager
const rootPkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf-8'));
const appPkg = {
  name: 'agent-monitor',
  version: rootPkg.version,
  main: 'tray.js',
};
fs.writeFileSync(path.join(distDir, 'package.json'), JSON.stringify(appPkg, null, 2));

async function main() {
  const appPaths = await packager({
    dir: distDir,
    name: 'Agent Monitor',
    platform: 'darwin',
    arch: process.arch,
    icon: path.join(distDir, 'appIcon.icns'),
    out: path.join(projectRoot, 'release'),
    overwrite: true,
    asar: true,
    ignore: [/\.map$/],
    appBundleId: 'com.pixel-agents.agent-monitor',
  });

  console.log(`\n✓ App packaged → ${appPaths[0]}\n`);

  // Clean up temporary package.json
  fs.unlinkSync(path.join(distDir, 'package.json'));
}

main().catch((err) => {
  console.error('Packaging failed:', err);
  process.exit(1);
});
