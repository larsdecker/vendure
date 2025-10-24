import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
    },
    resolve: {
        alias: {
            '@vendure/core': path.resolve(__dirname, 'test/stubs/vendure-core-stub.ts'),
        },
    },
});
