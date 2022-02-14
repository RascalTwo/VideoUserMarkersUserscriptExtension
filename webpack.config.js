const path = require('path');
const webpack = require('webpack')

const mode = process.env.NODE_ENV || 'development';
const isProd = mode === 'production';

module.exports = {
  mode,
  entry: path.resolve('./src/script.ts'),
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
    filename: 'userscript.js',
    path: path.resolve(__dirname, 'dist'),
  },
  plugins: isProd ? [] : [new webpack.SourceMapDevToolPlugin({
    sourceRoot: path.resolve(__dirname, 'src')
  })]
};