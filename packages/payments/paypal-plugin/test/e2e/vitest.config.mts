import path from 'path';
import { mergeConfig } from 'vitest/config';

import baseConfig from '../../../../../e2e-common/vitest.config.mts';

export default mergeConfig(baseConfig, {
    resolve: {
        alias: [
            {
                find: '@vendure/core/dist',
                replacement: path.resolve(__dirname, '../../../../core/dist'),
            },
            {
                find: '@vendure/core',
                replacement: path.resolve(__dirname, '../../../../core/dist/index.js'),
            },
            {
                find: '@vendure/common/lib/generated-types',
                replacement: path.resolve(__dirname, '../../../../common/lib/generated-types.js'),
            },
            {
                find: '@vendure/common/lib/generated-shop-types',
                replacement: path.resolve(__dirname, '../../../../common/lib/generated-shop-types.js'),
            },
            {
                find: '@vendure/common/lib/shared-utils',
                replacement: path.resolve(__dirname, '../../../../common/lib/shared-utils.js'),
            },
            {
                find: '@vendure/common/lib/simple-deep-clone',
                replacement: path.resolve(__dirname, '../../../../common/lib/simple-deep-clone.js'),
            },
            {
                find: '@vendure/common/lib/shared-types',
                replacement: path.resolve(__dirname, '../../../../common/lib/shared-types.js'),
            },
            {
                find: '@vendure/common/lib',
                replacement: path.resolve(__dirname, '../../../../common/lib'),
            },
            {
                find: '@vendure/common',
                replacement: path.resolve(__dirname, '../../../../common/lib/index.js'),
            },
            {
                find: '@vendure/testing',
                replacement: path.resolve(__dirname, '../../../../testing/lib/index.js'),
            },
        ],
    },
});
