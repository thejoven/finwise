// Default Expo Metro config + explicit opt-in for:
//   - tsconfig path aliases (`@/*` from tsconfig.json)
//   - package.json "exports" resolution (needed by modern libs like Zod 3.23+)
//
// If you ever see "Unable to resolve '@/...'" or "Package subpath './foo'
// is not defined by 'exports'", this file is the answer.
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
