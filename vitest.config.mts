import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Vitest transpiles with esbuild, which does not emit decorator metadata, so
  // Nest could not resolve a constructor dependency under test. SWC emits it.
  // The shipped build is compiled by tsc, not by this.
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/index.ts', 'src/**/*.d.ts'],
      thresholds: {
        // Set at what the suite actually reaches, so a drop fails the build.
        // The remainder is defensive branches: a store answering for a call it
        // never recorded, a logger path, a rethrow of an unexpected error.
        lines: 98,
        functions: 98,
        branches: 92,
        statements: 98,
      },
    },
  },
});
