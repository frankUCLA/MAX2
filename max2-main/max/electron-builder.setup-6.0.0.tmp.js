const packageJson = require('./package.json');

module.exports = {
  ...packageJson.build,
  directories: {
    ...packageJson.build.directories,
    output: 'dist-build-6.0.0'
  },
  extraMetadata: {
    version: '6.0.0'
  },
  publish: null
};
