/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ['192.168.1.8'],
  output: 'export',
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
