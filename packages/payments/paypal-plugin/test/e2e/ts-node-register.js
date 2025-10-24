const path = require('path');
const rootDir = path.resolve(__dirname, '../../../../../');
const paths = {
    '@vendure/core': ['packages/core/src'],
    '@vendure/core/*': ['packages/core/src/*'],
    '@vendure/core/dist': ['packages/core/src'],
    '@vendure/core/dist/*': ['packages/core/src/*'],
    '@vendure/core/src': ['packages/core/src'],
    '@vendure/core/src/*': ['packages/core/src/*'],
    '@vendure/common': ['packages/common/src'],
    '@vendure/common/*': ['packages/common/src/*'],
    '@vendure/common/lib': ['packages/common/src'],
    '@vendure/common/lib/*': ['packages/common/src/*'],
    '@vendure/testing': ['packages/testing/src'],
    '@vendure/testing/*': ['packages/testing/src/*'],
};
require('ts-node').register({
    transpileOnly: true,
    compilerOptions: {
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        baseUrl: rootDir,
        paths,
    },
});
require('tsconfig-paths').register({ baseUrl: rootDir, paths });
