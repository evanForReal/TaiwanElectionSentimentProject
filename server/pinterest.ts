import crypto from "node:crypto";
import { getSetting, setSetting } from "./db.ts";

// Pinterest API v5. Requires a developer app: https://developers.pinterest.com/apps/
const API = "https://api.pinterest.com/v5";
const SCOPES = "boards:read,pins:read,user_accounts:read";

export function pinterestConfig() {
  const clientId = getSetting("pinterest_client_id") ?? process.env.PINTEREST_CLIENT_ID ?? "";
  const clientSecret = getSetting("pinterest_client_secret") ?? process.env.PINTEREST_CLIENT_SECRET ?? "";
  const redirectUri =
    getSetting("pinterest_redirect_uri") ??
    process.env.PINTEREST_REDIRECT_URI ??
    `http://localhost:${process.env.PORT ?? 3001}/api/pinterest/callback`;
  return { clientId, clientSecret, redirectUri, configured: Boolean(clientId && clientSecret) };
}

interface Tokens {
  access_token: string;
  refresh_token?: string;
  expires_at: number; // ms
}

const tokens = (): Tokens | null => {
  const raw = getSetting("pinterest_tokens");
  return raw ? (JSON.parse(raw) as Tokens) : null;
};

export const pinterestConnected = () => tokens() !== null;

export function disconnectPinterest() {
  setSetting("pinterest_tokens", null);
}

let pendingState: string | null = null;

export function authorizeUrl(): string {
  const { clientId, redirectUri } = pinterestConfig();
  pendingState = crypto.randomBytes(16).toString("hex");
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
    state: pendingState,
  });
  return `https://www.pinterest.com/oauth/?${q}`;
}

async function tokenRequest(body: Record<string, string>): Promise<Tokens> {
  const { clientId, clientSecret } = pinterestConfig();
  const res = await fetch(`${API}/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body),
  });
  const data = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; message?: string };
  if (!res.ok || !data.access_token) throw new Error(`Pinterest token exchange failed: ${data.message ?? res.status}`);
  const t: Tokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? tokens()?.refresh_token,
    expires_at: Date.now() + (data.expires_in ?? 2592000) * 1000,
  };
  setSetting("pinterest_tokens", JSON.stringify(t));
  return t;
}

export async function handleCallback(code: string, state: string) {
  if (!pendingState || state !== pendingState) throw new Error("OAuth state mismatch; start the connection again.");
  pendingState = null;
  await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: pinterestConfig().redirectUri });
}

async function accessToken(): Promise<string> {
  const t = tokens();
  if (!t) throw new Error("Pinterest is not connected.");
  if (t.expires_at - Date.now() > 60_000 || !t.refresh_token) return t.access_token;
  return (await tokenRequest({ grant_type: "refresh_token", refresh_token: t.refresh_token })).access_token;
}

async function api<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${await accessToken()}` } });
  if (res.status === 401) {
    disconnectPinterest();
    throw new Error("Pinterest session expired. Reconnect on the Settings page.");
  }
  if (!res.ok) throw new Error(`Pinterest API error ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

export interface PinterestBoard {
  id: string;
  name: string;
  description: string;
  pinCount: number;
  coverUrl: string | null;
}

export async function listBoards(): Promise<PinterestBoard[]> {
  const boards: PinterestBoard[] = [];
  let bookmark: string | undefined;
  do {
    const page = await api<{
      items: { id: string; name: string; description?: string; pin_count?: number; media?: { image_cover_url?: string } }[];
      bookmark?: string | null;
    }>(`/boards?page_size=100${bookmark ? `&bookmark=${bookmark}` : ""}`);
    for (const b of page.items)
      boards.push({
        id: b.id,
        name: b.name,
        description: b.description ?? "",
        pinCount: b.pin_count ?? 0,
        coverUrl: b.media?.image_cover_url ?? null,
      });
    bookmark = page.bookmark ?? undefined;
  } while (bookmark && boards.length < 1000);
  return boards;
}

export interface RemotePin {
  id: string;
  title: string;
  link: string | null;
  imageUrl: string | null;
}

type ApiPin = {
  id: string;
  title?: string | null;
  description?: string | null;
  link?: string | null;
  media?: { images?: Record<string, { url: string; width: number }> };
};

function bestImage(p: ApiPin): string | null {
  const imgs = p.media?.images;
  if (!imgs) return null;
  return (imgs["1200x"] ?? imgs["originals"] ?? imgs["600x"] ?? Object.values(imgs)[0])?.url ?? null;
}

const toRemote = (p: ApiPin): RemotePin => ({
  id: p.id,
  title: p.title || p.description || "",
  link: p.link ?? `https://www.pinterest.com/pin/${p.id}/`,
  imageUrl: bestImage(p),
});

export async function listBoardPins(boardId: string, limit = 250): Promise<RemotePin[]> {
  const pins: RemotePin[] = [];
  let bookmark: string | undefined;
  do {
    const page = await api<{ items: ApiPin[]; bookmark?: string | null }>(
      `/boards/${boardId}/pins?page_size=100${bookmark ? `&bookmark=${bookmark}` : ""}`,
    );
    pins.push(...page.items.map(toRemote));
    bookmark = page.bookmark ?? undefined;
  } while (bookmark && pins.length < limit);
  return pins.slice(0, limit);
}

export async function getPinViaApi(pinId: string): Promise<RemotePin> {
  return toRemote(await api<ApiPin>(`/pins/${pinId}`));
}

/**
 * Resolves a pasted URL to an image. Direct image links are used as is. Pinterest pin links
 * use the API when connected, otherwise the page's public preview image (og:image).
 */
export async function resolvePastedUrl(url: string): Promise<{ imageUrl: string; title: string; link: string; pinId: string | null }> {
  const pinMatch = url.match(/pinterest\.[a-z.]+\/pin\/(?:[^/]*--)?(\d+)/i);
  if (pinMatch && pinterestConnected()) {
    try {
      const p = await getPinViaApi(pinMatch[1]);
      if (p.imageUrl) return { imageUrl: p.imageUrl, title: p.title, link: url, pinId: p.id };
    } catch {
      // fall through to the public preview
    }
  }
  if (/\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(url)) return { imageUrl: url, title: "", link: url, pinId: null };
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (InteriorStudio link preview)" }, redirect: "follow" });
  const type = res.headers.get("content-type") ?? "";
  if (type.startsWith("image/")) return { imageUrl: url, title: "", link: url, pinId: null };
  const html = await res.text();
  const meta = (prop: string) =>
    html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, "i"))?.[1] ??
    html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, "i"))?.[1];
  const image = meta("og:image") ?? meta("twitter:image");
  if (!image) throw new Error("No image found at that link.");
  return {
    imageUrl: image.replace(/&amp;/g, "&"),
    title: (meta("og:title") ?? "").replace(/&amp;/g, "&"),
    link: url,
    pinId: pinMatch?.[1] ?? null,
  };
}
