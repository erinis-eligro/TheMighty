const { version } = require('./package.json');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  env: {
    // 버전의 단일 소스는 frontend/package.json 의 version.
    NEXT_PUBLIC_APP_VERSION: version,
  },
};

module.exports = nextConfig;
