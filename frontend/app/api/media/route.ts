import { NextRequest, NextResponse } from "next/server";

/**
 * Proxy for Supabase storage images.
 * Allows the browser to load images from a same-origin URL (/api/media?url=...)
 * instead of directly from localhost:54321, avoiding cross-port browser restrictions.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) return NextResponse.json({ error: "missing url" }, { status: 400 });

  try {
    const res = await fetch(url, { cache: "force-cache" });
    if (!res.ok) {
      return NextResponse.json({ error: "upstream error" }, { status: res.status });
    }
    const buffer = await res.arrayBuffer();
    const contentType = res.headers.get("Content-Type") || "application/octet-stream";
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return NextResponse.json({ error: "fetch failed" }, { status: 500 });
  }
}
