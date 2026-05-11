import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

const localBackend = "http://localhost:4000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      "/api": localBackend,
      "/uploads": localBackend,
    },
  },
  preview: {
    port: 4173,
    proxy: {
      "/api": localBackend,
      "/uploads": localBackend,
    },
  },
});

