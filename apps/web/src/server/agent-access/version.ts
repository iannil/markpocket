import pkg from '../../../package.json';

// The web app's own version — MCP serverInfo and the skill template both
// report it, so an agent can tell instances apart across upgrades.
export const packageVersion: string = pkg.version;
export const productName: string = pkg.name;
