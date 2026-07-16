import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    agents: 'src/agents/registry.ts',
  },
  format: ['esm'],
  dts: true,
  deps: {
    neverBundle: ['zod', 'smol-toml', '@switchdash/core'],
  },
  sourcemap: true,
  clean: true,
});
