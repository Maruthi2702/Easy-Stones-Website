// The app reuses the website's pure rule modules (../src/features/locationCollector, ../src/utils): the native collector applies the very
// same window, keep, batching and heartbeat rules as the page did. Metro only looks inside the project folder by default, so the website's
// `src` is added as a watch folder; packages still come from THIS folder's node_modules only (the website's React is never loaded).
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const websiteSrc = path.resolve(projectRoot, '../src');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [...(config.watchFolders || []), websiteSrc];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
