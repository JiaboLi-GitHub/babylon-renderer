import { defineConfig } from 'vite';

export default defineConfig({
  assetsInclude: ['**/*.wasm'],
  optimizeDeps: {
    exclude: ['occt-import-js'],
  },
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'BabylonCubeView',
      fileName: 'index',
    },
    rollupOptions: {
      external: ['@babylonjs/core'],
      output: {
        globals: {
          '@babylonjs/core': 'BABYLON',
        },
      },
    },
  },
});
