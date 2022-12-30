const fs = require('fs');
const path = require('path');
const webpack = require('webpack')

const mode = process.env.NODE_ENV || 'development';
const isProd = mode === 'production';

const packageJSON = require('./package.json');
const manifest = require('./webext/manifest.json');
if (packageJSON.version !== manifest.version) {
  manifest.version = packageJSON.version;
  fs.writeFileSync(path.resolve(__dirname, 'webext/manifest.json'), JSON.stringify(manifest, null, 2));
}

module.exports = {
  mode,
  entry: {
    userscript: path.resolve('./src/script.ts'),
    '../webext/dist/userscript': path.resolve('./src/script.ts')
  },
  devtool: isProd ? undefined : 'inline-source-map',
  module: {
    rules: [{
      test: /\.ts?$/,
      use: isProd ? 'ts-loader' : ['@theintern/istanbul-loader', 'ts-loader'],
      exclude: /node_modules/,
    }],
  },
  resolve: { extensions: ['.ts'] },
  output: {
    filename: '[name].js',
    path: path.resolve(__dirname, 'dist'),
  },
  plugins: isProd ? [] : [new webpack.SourceMapDevToolPlugin({
    sourceRoot: path.resolve(__dirname, 'src')
  })]
};