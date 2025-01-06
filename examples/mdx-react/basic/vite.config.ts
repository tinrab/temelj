import { defineConfig, searchForWorkspaceRoot } from "vite";
import deno from "@deno/vite-plugin";
import react from "@vitejs/plugin-react";
import process from "node:process";

export default defineConfig({
  plugins: [deno(), react()],
  server: {
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd()), "../../../node_modules"],
    },
  },
});
