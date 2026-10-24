import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

describe("App", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the product name and the backend status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const body = url.endsWith("/api/health") ? { status: "ok", model: "fake" } : [];
        return new Response(JSON.stringify(body));
      }),
    );
    render(<App />);
    expect(screen.getByRole("heading", { name: "Randomy" })).toBeInTheDocument();
    expect(await screen.findByText("서버 연결됨 (모델: fake)")).toBeInTheDocument();
  });

  it("says when the backend is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("down");
      }),
    );
    render(<App />);
    expect(await screen.findByText("서버에 연결할 수 없습니다")).toBeInTheDocument();
  });
});
