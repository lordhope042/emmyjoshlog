const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const output = path.join(root, 'dist');
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

for (const entry of ['index.html', 'css', 'js', 'assets']) {
  fs.cpSync(path.join(root, entry), path.join(output, entry), { recursive: true });
}
for (const [source, destination] of [
  ['assets/emmyjosh-logo-original-crop.png', 'manus-storage/emmyjosh-logo-original-crop_1be053b9.png'],
  ['assets/emmyjosh-hero.webp', 'manus-storage/async-images/DUkoSpJ2nXlRVxpQJjP4OK/image-1.webp'],
]) {
  const alias = path.join(output, destination);
  fs.mkdirSync(path.dirname(alias), { recursive: true });
  fs.copyFileSync(path.join(root, source), alias);
}
fs.copyFileSync(path.join(root, 'public', 'manus-routes.json'), path.join(output, 'manus-routes.json'));
console.log(`Static site built to ${path.relative(root, output)}`);
