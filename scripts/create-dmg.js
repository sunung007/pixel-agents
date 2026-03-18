const path = require('path');
const fs = require('fs');
const appdmg = require('appdmg');

const projectRoot = path.resolve(__dirname, '..');
const rootPkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf-8'));
const version = rootPkg.version;
const arch = process.arch;

const appPath = path.join(
  projectRoot,
  'release',
  `Agent Monitor-darwin-${arch}`,
  'Agent Monitor.app',
);
const dmgPath = path.join(projectRoot, 'release', `AgentMonitor-${version}-${arch}.dmg`);

// Verify .app exists
if (!fs.existsSync(appPath)) {
  console.error(`Error: ${appPath} not found. Run "npm run package:mac" first.`);
  process.exit(1);
}

// Remove existing DMG if present (appdmg won't overwrite)
if (fs.existsSync(dmgPath)) {
  fs.unlinkSync(dmgPath);
}

const spec = {
  title: `Agent Monitor ${version}`,
  icon: path.join(projectRoot, 'src', 'tray', 'appIcon.icns'),
  'icon-size': 80,
  contents: [
    { x: 192, y: 344, type: 'file', path: appPath },
    { x: 448, y: 344, type: 'link', path: '/Applications' },
  ],
  window: {
    size: { width: 640, height: 480 },
  },
  format: 'UDBZ',
};

console.log(`Creating DMG: ${dmgPath}`);

const ee = appdmg({ basepath: projectRoot, specification: spec, target: dmgPath });

ee.on('progress', (info) => {
  if (info.type === 'step-begin') {
    process.stdout.write(`  ${info.title}...`);
  } else if (info.type === 'step-end') {
    process.stdout.write(' done\n');
  }
});

ee.on('finish', () => {
  const sizeMB = (fs.statSync(dmgPath).size / (1024 * 1024)).toFixed(1);
  console.log(`\n✓ DMG created → ${dmgPath} (${sizeMB} MB)\n`);
});

ee.on('error', (err) => {
  console.error('DMG creation failed:', err);
  process.exit(1);
});
