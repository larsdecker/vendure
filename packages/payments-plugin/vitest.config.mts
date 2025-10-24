import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        globals: false,
    },
    resolve: {
        alias: {
            '@vendure/core': path.resolve(__dirname, '../core/src/index.ts'),
            '@vendure/common': path.resolve(__dirname, '../common/src/index.ts'),
            '@vendure/common/lib': path.resolve(__dirname, '../common/src'),
            '@vendure/common/lib/generated-types': path.resolve(
                __dirname,
                '../common/src/generated-types.ts',
            ),
            '@vendure/common/lib/shared-types': path.resolve(
                __dirname,
                '../common/src/shared-types.ts',
            ),
        },
    },
});
