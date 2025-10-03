import { defineConfig } from "vite";
import fs from "fs";
import path from "path";

const certPath = path.resolve(__dirname, 'localhost+1.pem');
const keyPath = path.resolve(__dirname, 'localhost+1-key.pem');
const hasCerts = fs.existsSync(certPath) && fs.existsSync(keyPath);

export default defineConfig({
  base: "/", // Change to "/yamb-app/" if deploying to GitHub Pages at username.github.io/yamb-app/
  server: {
    open: true,
    port: 3000,
    ...(hasCerts && {
      https: {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath)
      }
    })
  },
  preview: {
    port: 4173,
    ...(hasCerts && {
      https: {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath)
      }
    })
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    minify: "esbuild",
    rollupOptions: {
      output: {
        manualChunks: undefined
      }
    }
  }
});