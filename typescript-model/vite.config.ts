import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "/typescript-model/",
  plugins: [react(), tailwindcss()],
  build: {
    // Vite measures uncompressed chunks; ExcelJS is only loaded for export and
    // the current lazy export bundle is 278 kB compressed.
    chunkSizeWarningLimit: 1024,
  },
  server: {
    open: "/typescript-model/",
    proxy: {
      "/api/v1/typescript-model": {
        target: `http://127.0.0.1:${process.env.PYME360_API_PORT ?? "8765"}`,
        changeOrigin: true,
      },
      "/api/v1/auth": {
        target: `http://127.0.0.1:${process.env.PYME360_API_PORT ?? "8765"}`,
        changeOrigin: true,
      },
      "/api/v1/audit": {
        target: `http://127.0.0.1:${process.env.PYME360_API_PORT ?? "8765"}`,
        changeOrigin: true,
      },
      "/api/v1/environment": {
        target: `http://127.0.0.1:${process.env.PYME360_API_PORT ?? "8765"}`,
        changeOrigin: true,
      },
      "/api/v1/e-invoicing": {
        target: `http://127.0.0.1:${process.env.PYME360_API_PORT ?? "8765"}`,
        changeOrigin: true,
      },
      "/api/v1/sync": {
        target: `http://127.0.0.1:${process.env.PYME360_API_PORT ?? "8765"}`,
        changeOrigin: true,
      },
    },
  },
});
