/** @type {import('next').NextConfig} */
const nextConfig = {
  reactCompiler: true,
  // Produce a self-contained server bundle in .next/standalone — required for
  // the Docker image to ship without dragging in all of node_modules.
  output: "standalone",
  // Dev only — accept HMR / static-asset requests from any IPv4 host (LAN,
  // WSL, Docker bridge, phone, etc.). Next.js rejects bare "*"; per-segment
  // wildcards are the supported way to match arbitrary hosts.
  allowedDevOrigins: ["*.*.*.*"],
};

export default nextConfig;
