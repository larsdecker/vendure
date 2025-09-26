import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['src/**/*.spec.ts'],
        environment: 'node',
        globals: false,
        alias: {
            '@vendure/payments-plugin': path.resolve(__dirname, 'src'),
        },
        coverage: {
            reporter: ['text', 'lcov'],
        },
    },
});
