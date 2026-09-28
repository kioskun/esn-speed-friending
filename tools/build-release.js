// Builds the download zip with only what an organiser needs:
//   app/ (the show, sounds, badges), phone-remote/, feedback-form/, HOW TO USE.txt
//
//   node tools/build-release.js v8.1      -> release/ESN-Speed-Friending-v8.1.zip
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const version = process.argv[2] || 'dev';
const name = `ESN-Speed-Friending-${version}`;
const outDir = path.join(ROOT, 'release');
const stage = path.join(outDir, name);
const zip = path.join(outDir, name + '.zip');

fs.rmSync(stage, { recursive: true, force: true });
fs.rmSync(zip, { force: true });
fs.mkdirSync(stage, { recursive: true });

const copy = (from, to) => fs.cpSync(path.join(ROOT, from), path.join(stage, to), { recursive: true });
copy('current', 'app');
for(const f of ['start-phone-remote.bat', 'allow-phone-in-firewall.bat', 'server.ps1', 'bridge.js', 'qrcode.js', 'remote.html', 'connect.html'])
  copy(path.join('phone-remote', f), path.join('phone-remote', f));
copy('feedback-form', 'feedback-form');
copy(path.join('tools', 'HOW TO USE.txt'), 'HOW TO USE.txt');

// Windows batch files need CRLF line endings
for(const f of ['start-phone-remote.bat', 'allow-phone-in-firewall.bat', 'server.ps1']){
  const p = path.join(stage, 'phone-remote', f);
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/\r?\n/g, '\r\n'));
}

if(process.platform === 'win32') execFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-a', '-c', '-f', name + '.zip', name], { cwd: outDir, stdio: 'inherit' });
else execFileSync('zip', ['-r', '-q', zip, name], { cwd: outDir, stdio: 'inherit' });
console.log(`Built ${path.relative(ROOT, zip)} (${(fs.statSync(zip).size / 1048576).toFixed(1)} MB)`);
