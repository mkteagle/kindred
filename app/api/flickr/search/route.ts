import { NextRequest, NextResponse } from "next/server";

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

interface FlickrSearchPhoto {
  id: string;
  server: string;
  secret: string;
  title: string;
  ownername: string;
  url_z?: string;
  url_b?: string;
  owner: string;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tags = searchParams.get("tags") || "";
    const text = searchParams.get("text") || "";
    const per_page = searchParams.get("per_page") || "50";
    const page = searchParams.get("page") || "1";

    if (!tags && !text) {
      return NextResponse.json({ error: "Need tags or text param" }, { status: 400 });
    }

    const url = flickrUrl({
      method: "flickr.photos.search",
      tags,
      text,
      per_page,
      page,
      extras: "url_z,url_b,owner_name,title,media",
      media: "photos",
      sort: "relevance",
    });

    const resp = await fetch(url);
    const data = await resp.json();

    if (data.stat !== "ok") {
      return NextResponse.json({ error: data.message }, { status: 400 });
    }

    const photos = data.photos.photo.map((p: FlickrSearchPhoto) => ({
      id: p.id,
      url: p.url_z || photoUrl(p, "z"),
      title: p.title,
      owner: p.ownername,
      thumb: photoUrl(p, "q"),
      flickrUrl: `https://www.flickr.com/photos/${p.owner}/${p.id}`,
      flickr_url: `https://www.flickr.com/photos/${p.owner}/${p.id}`,
    }));

    return NextResponse.json({
      photos,
      pagination: { page: data.photos.page, pages: data.photos.pages, total: data.photos.total },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
