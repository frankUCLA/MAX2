const packageJson = require('./package.json');

module.exports = {
  ...packageJson.build,
  directories: {
    ...packageJson.build.directories,
    output: 'dist-build-5.0.0'
  },
  extraFiles: [
    ...packageJson.build.extraFiles,
    {
      from: 'setup/5.0.0/edition.json',
      to: 'setup-edition.json'
    }
  ],
  extraMetadata: {
    version: '5.0.0'
  },
  publish: null
};
