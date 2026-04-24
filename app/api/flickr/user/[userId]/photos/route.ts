import { NextRequest, NextResponse } from "next/server";
import { getTokenFromRequest, signedFlickrUrl } from "@/lib/oauth";

const FLICKR_API = "https://api.flickr.com/services/rest";

function flickrUrl(params: Record<string, string | number>): string {
  const apiKey = process.env.FLICKR_API_KEY;
  if (!apiKey) throw new Error("FLICKR_API_KEY env var not set");
  const p = new URLSearchParams({
    api_key: apiKey,
    format: "json",
    nojsoncallback: "1",
    ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
  });
  return `${FLICKR_API}?${p}`;
}

function photoUrl(photo: { server: string; id: string; secret: string }, size = "z"): string {
  return `https://live.staticflickr.com/${photo.server}/${photo.id}_${photo.secret}_${size}.jpg`;
}

interface FlickrPhoto {
  id: string;
  server: string;
  secret: string;
  title: string;
  ownername?: string;
  url_z?: string;
  url_b?: string;
  owner?: string;
}

function mapPhoto(p: FlickrPhoto, resolvedUserId: string) {
  return {
    id: p.id,
    url: p.url_z || p.url_b || photoUrl(p, "z"),
    title: p.title,
    owner: p.ownername || resolvedUserId,
    thumb: photoUrl(p, "q"),
    flickrUrl: `https://www.flickr.com/photos/${resolvedUserId}/${p.id}`,
    flickr_url: `https://www.flickr.com/photos/${resolvedUserId}/${p.id}`,
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params;
    const { searchParams } = new URL(req.url);
    const all = searchParams.get("all");
    const page = searchParams.get("page") || "1";
    const per_page = searchParams.get("per_page") || "500";

    const token = getTokenFromRequest(req);
    const isOwnPhotos = token && (userId === "me" || userId === token.user_id);
    const resolvedUserId = isOwnPhotos ? token.user_id : userId;

    async function fetchPage(pageNum: number | string) {
      let url: string;
      let headers: Record<string, string> = {};
      if (isOwnPhotos && token) {
        const signed = signedFlickrUrl(
          "flickr.people.getPhotos",
          {
            user_id: token.user_id,
            per_page,
            page: pageNum,
            extras: "url_z,url_b,owner_name,title,media",
            media: "photos",
          },
          token as { oauth_token: string; oauth_token_secret: string }
        );
        url = signed.url;
        headers = signed.headers;
      } else {
        url = flickrUrl({
          method: "flickr.people.getPublicPhotos",
          user_id: userId,
          per_page,
          page: pageNum,
          extras: "url_z,url_b,owner_name,title,media",
          media: "photos",
        });
      }
      const resp = await fetch(url, { headers });
      return resp.json();
    }

    if (all === "true") {
      const firstPage = await fetchPage(1);
      if (firstPage.stat !== "ok") {
        return NextResponse.json({ error: firstPage.message }, { status: 400 });
      }

      let allPhotos = firstPage.photos.photo.map((p: FlickrPhoto) =>
        mapPhoto(p, resolvedUserId)
      );
      const totalPages = firstPage.photos.pages;

      for (let pg = 2; pg <= totalPages; pg++) {
        const pageData = await fetchPage(pg);
        if (pageData.stat === "ok") {
          allPhotos = allPhotos.concat(
            pageData.photos.photo.map((p: FlickrPhoto) => mapPhoto(p, resolvedUserId))
          );
        }
      }

      return NextResponse.json({
        photos: allPhotos,
        pagination: { page: 1, pages: 1, total: allPhotos.length, per_page: allPhotos.length },
      });
    }

    const data = await fetchPage(page);
    if (data.stat !== "ok") {
      return NextResponse.json({ error: data.message }, { status: 400 });
    }

    const photos = data.photos.photo.map((p: FlickrPhoto) => mapPhoto(p, resolvedUserId));

    return NextResponse.json({
      photos,
      pagination: {
        page: data.photos.page,
        pages: data.photos.pages,
        total: data.photos.total,
        per_page: data.photos.perpage,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
