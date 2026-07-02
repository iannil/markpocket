const withRspack = require('next-rspack');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

module.exports = withRspack(nextConfig);
