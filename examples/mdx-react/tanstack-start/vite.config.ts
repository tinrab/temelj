import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { mdx } from "@temelj/mdx/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "vendor",
              test: /[\\/]node_modules[\\/]/u,
              maxSize: 400_000,
              entriesAware: true,
            },
          ],
        },
      },
    },
  },
  plugins: [devtools(), tailwindcss(), mdx({ synchronous: true }), tanstackStart(), viteReact()],
});

export default config;
