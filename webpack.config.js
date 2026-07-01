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
        vscode: 'commonjs vscode',
        // Mark all node_modules as external — VS Code resolves them at runtime
        // This avoids bundling pi-agent-core, pi-ai, and all provider SDKs
        '@earendil-works/pi-agent-core': 'commonjs @earendil-works/pi-agent-core',
        '@earendil-works/pi-ai': 'commonjs @earendil-works/pi-ai',
        // Provider SDKs that pi-agent-core transitively depends on
        '@google/genai': 'commonjs @google/genai',
        '@mistralai/mistralai': 'commonjs @mistralai/mistralai',
        'openai': 'commonjs openai',
        'anthropic': 'commonjs anthropic',
    },
    devtool: 'nosources-source-map',
    stats: {
        errorDetails: true,
    },
};
