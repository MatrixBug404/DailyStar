import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { API_BASE } from '../../../lib/api';

export const dynamic = 'force-dynamic';

/**
 * DEPLOYMENT CONTRACT:
 * This route expects trusted proxy/client-IP headers from the deployed Next.js path.
 * The backend relies on the HMAC signature generated here to establish propagation trust
 * for rate-limiting the cover endpoints based on the actual client IP.
 */

function extractClientIp(headersList: Headers): string {
  // 1. Forwarded
  const forwarded = headersList.get('forwarded');
  if (forwarded) {
    const match = forwarded.match(/for="?([^";, ]+)"?/i);
    if (match && match[1]) {
      let ip = match[1];
      // strip brackets if ipv6 like [2001:db8::1] or [2001:db8::1]:port
      if (ip.startsWith('[')) {
        const endBracket = ip.indexOf(']');
        if (endBracket !== -1) {
          ip = ip.substring(1, endBracket);
        }
      } else {
        // strip port if ipv4 like 203.0.113.1:1234
        const colonIndex = ip.indexOf(':');
        if (colonIndex !== -1 && ip.split(':').length === 2) {
          ip = ip.substring(0, colonIndex);
        }
      }
      return ip;
    }
  }

  // 2. X-Real-IP
  const realIp = headersList.get('x-real-ip');
  if (realIp) {
    return realIp;
  }

  // 3. X-Forwarded-For
  const xff = headersList.get('x-forwarded-for');
  if (xff) {
    const parts = xff.split(',');
    if (parts.length > 0 && parts[0]) {
      return parts[0];
    }
  }

  // 4. Fallback
  return '127.0.0.1';
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  const secret = process.env.PUBLIC_COVER_PROXY_TRUST_SECRET;
  if (!secret) {
    throw new Error('Missing PUBLIC_COVER_PROXY_TRUST_SECRET');
  }

  const extractedIp = extractClientIp(request.headers);
  const normalizedIp = extractedIp.trim();

  const signature = crypto
    .createHmac('sha256', secret)
    .update(normalizedIp)
    .digest('hex');

  const headers = {
    'X-DailyStar-Client-IP': normalizedIp,
    'X-DailyStar-Client-IP-Signature': signature,
  };

  // 1. fetch article
  const articleRes = await fetch(`${API_BASE}/articles/${slug}`, {
    cache: 'no-store',
    headers,
  });

  if (!articleRes.ok) {
    if (articleRes.status === 404) {
      return new NextResponse(null, { status: 404 });
    }
    // Propagate network errors by throwing (will result in 500)
    throw new Error(`Failed to fetch article: ${articleRes.status}`);
  }

  const article = await articleRes.json();

  if (article.hasCoverImage === false) {
    return new NextResponse(null, { status: 404 });
  }

  // 2. fetch cover
  const coverRes = await fetch(`${API_BASE}/articles/${slug}/cover`, {
    cache: 'no-store',
    headers,
  });

  if (!coverRes.ok) {
    return new NextResponse(null, { status: 404 });
  }

  const cover = await coverRes.json();

  if (!cover.signedUrl) {
    return new NextResponse(null, { status: 404 });
  }

  return NextResponse.redirect(cover.signedUrl, 302);
}
