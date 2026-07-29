import type { NextConfig } from "next";

const isGitHubPages = process.env.GITHUB_PAGES === "true";
const pagesBasePath = process.env.PAGES_BASE_PATH ?? "/crossboard";
const projectRoot = process.env.INIT_CWD ?? process.cwd();
const sharedConfig: NextConfig = {
  turbopack: {
    root: projectRoot,
  },
};

const nextConfig: NextConfig = isGitHubPages
  ? {
      ...sharedConfig,
      output: "export",
      basePath: pagesBasePath,
      trailingSlash: true,
      images: {
        unoptimized: true,
      },
    }
  : sharedConfig;

export default nextConfig;
