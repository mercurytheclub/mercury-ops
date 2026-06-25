/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The brand source-of-truth lives outside src/ (vendor/brand submodule);
  // allow transpiling its TS token exports.
  transpilePackages: [],
};

export default nextConfig;
