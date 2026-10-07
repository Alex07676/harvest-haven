interface Env {
  ASSETS: Fetcher;
  GAME_SERVER_URL?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return Response.json({ ok: true, service: "harvest-haven-web", gameServerConfigured: Boolean(env.GAME_SERVER_URL) });
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;