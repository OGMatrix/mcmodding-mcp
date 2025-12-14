import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/**',
        'dist/**',
        '**/*.config.ts',
        '**/*.config.js',
        '**/types/**',
        '**/*.d.ts',
      ],
    },
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['node_modules', 'dist'],
    testTimeout: 60000,
  },
});
