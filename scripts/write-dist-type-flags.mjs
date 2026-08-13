// The two builds land in one package, so each output directory declares its own
// module system. Without these files Node reads the root package.json instead
// and loads the ESM build as CommonJS.
import { writeFileSync } from 'node:fs';

writeFileSync('dist/cjs/package.json', `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`);
writeFileSync('dist/esm/package.json', `${JSON.stringify({ type: 'module' }, null, 2)}\n`);
