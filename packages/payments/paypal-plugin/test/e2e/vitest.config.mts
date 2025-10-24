import path from 'path';
import { mergeConfig } from 'vitest/config';

import baseConfig from '../../../../../e2e-common/vitest.config.mts';

export default mergeConfig(baseConfig, {
    resolve: {
        alias: [
            {
                find: 'graphql/jsutils/inspect',
                replacement: path.resolve(
                    __dirname,
                    '../../../../../node_modules/graphql/jsutils/inspect.js',
                ),
            },
            {
                find: 'graphql',
                replacement: path.resolve(__dirname, '../../../../../node_modules/graphql/index.js'),
            },
            {
                find: '@vendure/core/dist/bootstrap',
                replacement: path.resolve(__dirname, '../../../../core/src/bootstrap.ts'),
            },
            {
                find: '@vendure/core/dist/app.module.js',
                replacement: path.resolve(__dirname, '../../../../core/src/app.module.ts'),
            },
            {
                find: '@vendure/core/dist',
                replacement: path.resolve(__dirname, '../../../../core/src'),
            },
            {
                find: '@vendure/core/src',
                replacement: path.resolve(__dirname, '../../../../core/src'),
            },
            {
                find: '@vendure/core',
                replacement: path.resolve(__dirname, '../../../../core/src'),
            },
            {
                find: '@vendure/common/lib/generated-types',
                replacement: path.resolve(__dirname, '../../../../common/src/generated-types.ts'),
            },
            {
                find: '@vendure/common/lib/generated-shop-types',
                replacement: path.resolve(__dirname, '../../../../common/src/generated-shop-types.ts'),
            },
            {
                find: '@vendure/common/lib/shared-utils',
                replacement: path.resolve(__dirname, '../../../../common/src/shared-utils.ts'),
            },
            {
                find: '@vendure/common/lib/simple-deep-clone',
                replacement: path.resolve(__dirname, '../../../../common/src/simple-deep-clone.ts'),
            },
            {
                find: '@vendure/common/lib/shared-types',
                replacement: path.resolve(__dirname, '../../../../common/src/shared-types.ts'),
            },
            {
                find: '@vendure/common/lib',
                replacement: path.resolve(__dirname, '../../../../common/src'),
            },
            {
                find: '@vendure/common',
                replacement: path.resolve(__dirname, '../../../../common/src/index.ts'),
            },
            {
                find: '@vendure/testing',
                replacement: path.resolve(__dirname, '../../../../testing/src/index.ts'),
            },
        ],
    },
});
