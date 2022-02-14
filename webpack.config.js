const path = require('path');

const mode = process.env.NODE_ENV || 'development';
const isProd = mode === 'production';

module.exports = {
  mode,
  entry: './src/script.ts',
  devtool: isProd ? undefined : 'inline-source-map',
  module: {
    rules: [{
      test: /\.ts?$/,
      use: 'ts-loader',
      exclude: /node_modules/,
    }],
  },
  resolve: { extensions: ['.ts'] },
  output: {
    filename: 'userscript.js',
    path: path.resolve(__dirname, 'dist'),
  },
};