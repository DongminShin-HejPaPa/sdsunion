import pg from 'pg';
const { Client } = pg;

export default async function handler(req, res) {
  // Only allow POST or GET
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // 구글 스크립트 API 호출
  const googleApiUrl = 'https://script.google.com/macros/s/AKfycbzVncXUtzfxlpmfD0ufVNnXkTcVMCI7-ERzWZZDqiK40Roah1hkxfFq9PIvfjdMwh2seQ/exec';
  let apiResponse;
  try {
    const response = await fetch(googleApiUrl);
    if (!response.ok) {
      throw new Error(`Google API responded with status ${response.status}`);
    }
    apiResponse = await response.json();
  } catch (err) {
    console.error('Failed to fetch from Google Script API:', err);
    return res.status(500).json({ error: 'Failed to fetch external data' });
  }

  const { memberCount } = apiResponse;
  if (typeof memberCount !== 'number') {
    return res.status(500).json({ error: 'Invalid data format from API', apiResponse });
  }

  const timestamp = new Date().toISOString();

  // Neon DB 저장
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();
    await client.query(
      'INSERT INTO member_counts (timestamp, count) VALUES ($1, $2)',
      [timestamp, memberCount]
    );
    await client.end();
    
    return res.status(200).json({ success: true, timestamp, count: memberCount });
  } catch (err) {
    console.error('Database insertion error:', err);
    // Ignore error if it's somehow a duplicate timestamp, though rare for ISOString
    await client.end().catch(console.error);
    return res.status(500).json({ error: 'Failed to save to database' });
  }
};
