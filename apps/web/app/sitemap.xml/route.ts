import { NextResponse } from 'next/server';
import { fetchPublicApi } from '../../lib/api';

export const revalidate = 3600;

function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

function normalizeUrl(baseUrl: string, path: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

export async function GET() {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
  const maxUrls = 50000;
  let urlCount = 0;

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

  function addUrl(path: string, lastmod?: string) {
    if (urlCount >= maxUrls) return false;

    xml += `  <url>\n`;
    xml += `    <loc>${escapeXml(normalizeUrl(baseUrl, path))}</loc>\n`;
    if (lastmod) {
      xml += `    <lastmod>${escapeXml(lastmod)}</lastmod>\n`;
    }
    xml += `  </url>\n`;

    urlCount++;
    return true;
  }

  // 1. Homepage
  if (!addUrl('/')) {
    console.warn(`Sitemap limit of ${maxUrls} reached.`);
    xml += `</urlset>`;
    return new NextResponse(xml, { headers: { 'Content-Type': 'application/xml' } });
  }

  // 2. Categories
  const categories = await fetchPublicApi('/public/categories');

  // Flatten categories
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const flattenCategories = (cats: any[]) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let flat: any[] = [];
    for (const cat of cats) {
      flat.push(cat);
      if (cat.children && cat.children.length > 0) {
        flat = flat.concat(flattenCategories(cat.children));
      }
    }
    return flat;
  };

  if (Array.isArray(categories)) {
    const flatCategories = flattenCategories(categories);
    for (const cat of flatCategories) {
      if (cat.publishedArticleCount > 0) {
        if (!addUrl(`/category/${cat.slug}`)) {
          console.warn(`Sitemap limit of ${maxUrls} reached during categories.`);
          xml += `</urlset>`;
          return new NextResponse(xml, { headers: { 'Content-Type': 'application/xml' } });
        }
      }
    }
  }

  // 3. Articles
  let page = 1;
  const limit = 50;
  let hasMore = true;

  while (hasMore) {
    if (urlCount >= maxUrls) {
      console.warn(`Sitemap limit of ${maxUrls} reached during articles.`);
      break;
    }

    const articlesResponse = await fetchPublicApi(`/public/articles?page=${page}&limit=${limit}`);

    if (!articlesResponse || !Array.isArray(articlesResponse.data)) {
      break;
    }

    const articles = articlesResponse.data;

    for (const article of articles) {
      if (!addUrl(`/article/${article.slug}`, article.publishedRevisionCreatedAt)) {
        console.warn(`Sitemap limit of ${maxUrls} reached during articles.`);
        hasMore = false;
        break;
      }
    }

    if (articles.length < limit) {
      hasMore = false;
    } else {
      page++;
    }
  }

  xml += `</urlset>`;

  return new NextResponse(xml, { headers: { 'Content-Type': 'application/xml' } });
}
