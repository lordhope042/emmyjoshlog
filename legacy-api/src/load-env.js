'use strict';

const path = require('node:path');
const dotenv = require('dotenv');

// Always load the single project-root .env, regardless of the process cwd.
const rootEnvPath = path.resolve(__dirname, '..', '..', '.env');
const result = dotenv.config({ path: rootEnvPath });

if (result.error && result.error.code !== 'ENOENT') {
  throw result.error;
}

module.exports = { rootEnvPath };
