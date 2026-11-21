// Metro: Expo's defaults, with test code kept out of every bundle, wrapped by Uniwind, which
// compiles the Tailwind classes and must stay the outermost wrapper. bun's default (isolated)
// linker needs nothing more: Expo resolves the workspace packages through their symlinks.
const path = require("node:path");

const { getDefaultConfig } = require("expo/metro-config");
const { withUniwindConfig } = require("uniwind/metro");

/** A RegExp matching `directory` and everything below it, on any platform's separators. */
function under(directory) {
  const segments = directory
    .split(/[\\/]/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${segments.join("[\\\\/]")}[\\\\/]`);
}

const config = getDefaultConfig(__dirname);

config.resolver.blockList = [
  ...[].concat(config.resolver.blockList ?? []),
  // Test files anywhere in the workspace, but never a dependency's files.
  /^(?!.*[\\/]node_modules[\\/]).*\.test\.[cm]?[jt]sx?$/,
  // This app's test helpers and fakes.
  under(path.join(__dirname, "src", "test")),
];

module.exports = withUniwindConfig(config, {
  cssEntryFile: "./src/global.css",
  dtsFile: "./src/uniwind-types.d.ts",
});
