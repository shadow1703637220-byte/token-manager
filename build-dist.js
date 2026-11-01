'use strict';
/*
 * 发行打包：把本地 Token 管家打成「所有人下载就能用」的成品
 * - Windows: Node SEA 单文件 exe（双击运行，自动开浏览器，关窗口退出）
 * - macOS: .app 套装（v1.0.2 起改 AppleScript applet 外壳：真应用进程、程序坞有图标；
 *   osacompile 只能在 macOS 上跑，本脚本只备料 payload，最终组装在 Mac 上完成）
 * - Linux: SEA 单文件（主要用于本机自测打包管线）
 * 用法: node build-dist.js [win|mac|linux|all]
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const WORK = path.join(ROOT, 'dist-build');
const OUT = path.join(ROOT, 'dist');
const NODE_VER = 'v24.22.1';
const FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
fs.mkdirSync(path.join(WORK, 'cache'), { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

function run(cmd) { console.log('+', cmd); execSync(cmd, { stdio: 'inherit' }); }

// 1) 发行版主文件：强制 TM_DIST=1
const serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const distMain = path.join(WORK, 'dist-main.js');
fs.writeFileSync(distMain, "process.env.TM_DIST='1';\n" + serverSrc);

// 2) SEA blob
fs.writeFileSync(path.join(WORK, 'sea-config.json'), JSON.stringify({ main: distMain, output: path.join(WORK, 'sea-prep.blob'), disableExperimentalSEAWarning: true }, null, 2));
run('node --experimental-sea-config ' + path.join(WORK, 'sea-config.json'));

function download(url, dest) {
  if (fs.existsSync(dest)) { console.log('cache hit', path.basename(dest)); return; }
  run('curl -sL -o ' + dest + ' ' + url);
}
function nodeBinaryFor(kind) {
  const cache = path.join(WORK, 'cache');
  if (kind === 'win') {
    const zip = path.join(cache, 'node-win.zip');
    download('https://nodejs.org/dist/' + NODE_VER + '/node-' + NODE_VER + '-win-x64.zip', zip);
    const dir = path.join(cache, 'win');
    if (!fs.existsSync(path.join(dir, 'node.exe'))) {
      fs.mkdirSync(dir, { recursive: true });
      run('python3 -c "import zipfile; zipfile.ZipFile(\'' + zip + '\').extractall(\'' + dir + '\')"');
      run('cp ' + dir + '/node-' + NODE_VER + '-win-x64/node.exe ' + dir + '/node.exe');
    }
    return path.join(dir, 'node.exe');
  }
  if (kind === 'linux') return process.execPath;
  const tar = path.join(cache, 'node-' + kind + '.tar.gz');
  download('https://nodejs.org/dist/' + NODE_VER + '/node-' + NODE_VER + '-' + kind + '.tar.gz', tar);
  const dir = path.join(cache, kind);
  if (!fs.existsSync(path.join(dir, 'node'))) {
    fs.mkdirSync(dir, { recursive: true });
    run('tar -xzf ' + tar + ' -C ' + dir + ' --no-same-owner --strip-components=2 --wildcards "*/bin/node"');
  }
  return path.join(dir, 'node');
}

function buildSea(kind, outName) {
  const bin = nodeBinaryFor(kind);
  const out = path.join(OUT, outName);
  run('cp ' + bin + ' ' + out);
  run('npx --yes postject ' + out + ' NODE_SEA_BLOB ' + path.join(WORK, 'sea-prep.blob') + ' --sentinel-fuse ' + FUSE);
  console.log('built', out, (fs.statSync(out).size / 1048576).toFixed(1) + 'MB');
}

function buildMac(arch) {
  // v1.0.2：Mac 外壳是 AppleScript applet（mac-app/TokenManager.applescript），
  // 只能在 macOS 上用 osacompile 编译。本函数只备料到 dist/mac-<arch>/payload/，
  // 组装步骤写在 TokenManager.applescript 文件头（Build on a Mac 一节）。
  const kind = 'darwin-' + arch;
  const nodeBin = nodeBinaryFor(kind);
  const payload = path.join(OUT, 'mac-' + arch, 'payload');
  fs.mkdirSync(payload, { recursive: true });
  fs.copyFileSync(nodeBin, path.join(payload, 'node'));
  fs.copyFileSync(path.join(ROOT, 'server.js'), path.join(payload, 'server.js'));
  fs.copyFileSync(path.join(ROOT, 'mac-app', 'AppIcon.icns'), path.join(payload, 'applet.icns'));
  console.log('mac payload staged →', payload, '（node / server.js / applet.icns，在 Mac 上组装）');
}

const target = process.argv[2] || 'all';
if (target === 'win' || target === 'all') buildSea('win', 'TokenManager-Windows.exe');
if (target === 'linux' || target === 'all') buildSea('linux', 'TokenManager-Linux');
if (target === 'mac' || target === 'all') { buildMac('arm64'); buildMac('x64'); }
console.log('done →', OUT);
