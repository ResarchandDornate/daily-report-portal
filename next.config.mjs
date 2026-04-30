/** @type {import('next').NextConfig} */
const nextConfig = {
  reactCompiler: true,
  // Dev only — accept HMR / static-asset requests from any host (LAN, WSL,
  // Docker bridge, phone, etc.) instead of maintaining an IP allowlist.
  allowedDevOrigins: ["*"],
};

export default nextConfig;
