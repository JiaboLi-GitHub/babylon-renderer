import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'BabylonCubeView',
      fileName: 'index',
    },
    rollupOptions: {
      external: ['@babylonjs/core'],
    },
  },
});
