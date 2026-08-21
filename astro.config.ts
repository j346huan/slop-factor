import { defineConfig } from "astro/config";

const [repositoryOwner, repositoryName] = (
  process.env.GITHUB_REPOSITORY ?? "/"
).split("/");
const actionBase = repositoryName ? `/${repositoryName}` : "/";
const base =
  process.env.SITE_BASE ??
  (process.env.GITHUB_ACTIONS === "true" ? actionBase : "/");
const site = repositoryOwner
  ? `https://${repositoryOwner}.github.io`
  : undefined;

export default defineConfig({
  base,
  build: {
    assets: "assets",
  },
  output: "static",
  site,
  trailingSlash: "always",
});
