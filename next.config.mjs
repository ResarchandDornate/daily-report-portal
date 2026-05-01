/** @type {import('next').NextConfig} */
const nextConfig = {
  reactCompiler: true,
  // Dev only — accept HMR / static-asset requests from any IPv4 host (LAN,
  // WSL, Docker bridge, phone, etc.). Next.js rejects bare "*"; per-segment
  // wildcards are the supported way to match arbitrary hosts.
  allowedDevOrigins: ["*.*.*.*"],
};

export default nextConfig;
