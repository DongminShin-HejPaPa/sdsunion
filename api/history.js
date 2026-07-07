import pg from 'pg';
const { Client } = pg;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();
    // Fetch all records ordered by timestamp
    const result = await client.query('SELECT timestamp, count FROM member_counts ORDER BY timestamp ASC');
    await client.end();
    
    // The database returns Date objects for TIMESTAMPTZ, we want ISO strings
    const formattedData = result.rows.map(row => ({
      timestamp: row.timestamp.toISOString(),
      count: row.count
    }));

    return res.status(200).json(formattedData);
  } catch (err) {
    console.error('Database query error:', err);
    try { await client.end(); } catch (e) {}
    return res.status(500).json({ error: 'Failed to fetch history' });
  }
};
