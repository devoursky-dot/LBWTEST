export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const folderId = searchParams.get('id') || '1Ew38nohOksBhypc2UjHYTmi6bSjbICmn';
  const targetUrl = `https://drive.google.com/embeddedfolderview?id=${folderId}#list`;

  try {
    const res = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    const html = await res.text();
    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Failed to fetch drive HTML' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
