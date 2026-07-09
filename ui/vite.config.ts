import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev proxy is a fallback for when the conductor lacks CORS; the deployed
// conductor sends permissive CORS so direct calls work too.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
});
