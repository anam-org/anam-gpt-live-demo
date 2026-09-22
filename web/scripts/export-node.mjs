// Optional standalone copy; web/ itself is already deployable to Vercel.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../', import.meta.url));
const destination = path.resolve(process.argv[2] || path.join(source, '../web-node'));
if (existsSync(destination)) throw new Error(`Destination already exists: ${destination}`);
if (destination.startsWith(source + path.sep)) throw new Error('Choose a destination outside web/.');
mkdirSync(destination, { recursive: true });

for (const entry of ['app', 'components', 'hooks', 'lib', 'public', 'vendor',
  'package.json', 'package-lock.json', 'postcss.config.mjs', 'next.config.ts',
  'eslint.config.mjs', 'tsconfig.json', 'vercel.json', 'README.md', '.env.example', '.gitignore']) {
  cpSync(path.join(source, entry), path.join(destination, entry), { recursive: true });
}

console.log(`Exported Next.js frontend to ${destination}`);
