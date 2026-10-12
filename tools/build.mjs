import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'dist');
if (path.dirname(output) !== path.resolve(root)) throw new Error('Unsafe output directory');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const name of ['index.html', 'style.css', '.nojekyll', 'src', 'data', 'vendor', 'LICENSE', 'NOTICE.md']) {
  await cp(path.join(root, name), path.join(output, name), { recursive: true });
}
console.log('Built static website in dist/');
