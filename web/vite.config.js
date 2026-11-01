import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: the API runs on PORT (default 5050, npm start) and Vite on VITE_PORT (default 5051). /api is proxied, so the browser only ever
// talks to one origin (same-origin writes). Both ports are inside the 5050-5099 range this lab owns.
const api = { target: `http://127.0.0.1:${Number(process.env.PORT) || 5050}` };

export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", port: Number(process.env.VITE_PORT) || 5051, strictPort: true, proxy: { "/api": api } },
  // The server core (the real evaluator, mock AS and runner) is loaded by Node itself in tests, so its data files resolve normally.
  test: { environment: "jsdom", globals: true, setupFiles: "./src/testSetup.js", server: { deps: { external: [/\/server\/src\//] } } },
});
