'use strict';

// Builds a minified copy of the website into ./dist for production.
//
//   npm install --save-dev esbuild
//   node tools/build-dist.js
//   SERVE_DIST=1 npm start        (server.js then serves ./dist instead of the source files)
//
// Each file is minified on its own and keeps its module structure, so lazy loading of the admin
// console keeps working. Source files are never modified. Nothing is bundled or renamed.

const fs = require('node:fs');
const path = require('node:path');

let esbuild;
try { esbuild = require('esbuild'); } catch {
  console.error('esbuild is not installed. Run: npm install --save-dev esbuild');
  process.exit(1);
}

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

function ensure(dir) { fs.mkdirSync(dir, { recursive: true }); }
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

fs.rmSync(dist, { recursive: true, force: true });
ensure(dist);

let before = 0;
let after = 0;

for (const [folder, loader] of [['js', 'js'], ['css', 'css']]) {
  const source = path.join(root, folder);
  if (!fs.existsSync(source)) continue;
  for (const file of walk(source)) {
    const target = path.join(dist, path.relative(root, file));
    ensure(path.dirname(target));
    const ext = path.extname(file).toLowerCase();
    if (ext !== `.${loader}`) { fs.copyFileSync(file, target); continue; }
    const input = fs.readFileSync(file, 'utf8');
    const output = esbuild.transformSync(input, {
      loader,
      minify: true,
      target: loader === 'js' ? 'es2020' : 'chrome90',
      legalComments: 'none',
    }).code;
    fs.writeFileSync(target, output);
    before += Buffer.byteLength(input);
    after += Buffer.byteLength(output);
  }
}

// Static files copied as they are.
const assets = path.join(root, 'assets');
if (fs.existsSync(assets)) {
  for (const file of walk(assets)) {
    const target = path.join(dist, path.relative(root, file));
    ensure(path.dirname(target));
    fs.copyFileSync(file, target);
  }
}
fs.copyFileSync(path.join(root, 'index.html'), path.join(dist, 'index.html'));
const routes = path.join(root, 'public', 'manus-routes.json');
if (fs.existsSync(routes)) fs.copyFileSync(routes, path.join(dist, 'manus-routes.json'));

const saved = before ? Math.round((1 - after / before) * 100) : 0;
console.log(`Built dist/: JS and CSS ${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB (${saved}% smaller).`);
