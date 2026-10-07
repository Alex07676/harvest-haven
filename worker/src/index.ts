interface Env {
  ASSETS: Fetcher;
  GAME_SERVER_URL?: string;
  GAME_SERVER_HTTP_URL?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return Response.json({ ok: true, service: "harvest-haven-web", gameServerConfigured: Boolean(env.GAME_SERVER_URL) });
    }
    if (url.pathname === "/game" || url.pathname.startsWith("/api/")) {
      const upstreamBase = env.GAME_SERVER_HTTP_URL ?? toHttpUrl(env.GAME_SERVER_URL);
      if (!upstreamBase) return Response.json({ ok: false, error: "Game server is not configured." }, { status: 503 });
      const upstreamUrl = new URL(`${upstreamBase}${url.pathname}${url.search}`);
      return fetch(new Request(upstreamUrl, request));
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

function toHttpUrl(webSocketUrl?: string): string | undefined {
  if (!webSocketUrl) return undefined;
  return webSocketUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:").replace(/\/game\/?$/, "");
}