const path = require('path');

module.exports = {
    target: 'node',
    mode: 'production',
    entry: './src/extension.ts',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'extension.js',
        libraryTarget: 'commonjs2',
    },
    resolve: {
        extensions: ['.ts', '.js'],
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                use: 'ts-loader',
                exclude: /node_modules/,
            },
        ],
    },
    externals: {
        // Only vscode is external — provided by VS Code runtime
        vscode: 'commonjs vscode',
        // Everything else (pi-agent-core, pi-ai, provider SDKs) gets bundled
    },
    devtool: 'nosources-source-map',
    stats: {
        errorDetails: true,
    },
    ignoreWarnings: [
        // ws optional native deps — not needed, ws falls back to JS
        /Can't resolve 'bufferutil'/,
        /Can't resolve 'utf-8-validate'/,
        // Dynamic requires in provider SDKs — safe
        /Critical dependency: the request of a dependency is an expression/,
    ],
};
