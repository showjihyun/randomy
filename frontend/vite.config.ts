import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // shadcn/ui 경로 별칭 (DESIGN.md 1장)
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  server: {
    // 사용자 흐름 테스트(Playwright)는 실행마다 다른 포트의 백엔드를 띄운다
    proxy: { "/api": process.env.RANDOMY_API_URL ?? "http://localhost:8000" },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
