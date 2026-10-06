// electron-builder afterPack hook.
//
// The build is unsigned (no Apple Developer cert; package.json sets
// mac.identity = null, which makes electron-builder SKIP code signing). On
// Apple Silicon an app with no valid bundle signature is refused by
// Gatekeeper/LaunchServices and simply won't launch from Finder or `open`.
//
// This hook ad-hoc signs the .app (`codesign --sign -`) right after packing and
// before the zip is built, so the resulting app — and the distributed zip —
// launch locally without a paid signing identity.
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  console.log(`[afterPack] ad-hoc signing ${appPath}`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
};
