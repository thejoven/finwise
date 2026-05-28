module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    // Path aliases (`@/*`) are handled by Expo's Metro config via tsconfig.json
    // since SDK 50+ — no babel-plugin-module-resolver needed.
    //
    // Reanimated 4 split out the babel plugin into react-native-worklets.
    // (Pre-RN-Reanimated-4 it was "react-native-reanimated/plugin".)
    // Must be the LAST entry.
    plugins: ["react-native-worklets/plugin"],
  };
};
