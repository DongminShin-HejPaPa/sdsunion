import pg from 'pg';
const { Client } = pg;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { sessionId, isNewVisit } = req.query;

  if (!sessionId) {
    return res.status(400).json({ error: 'Missing sessionId' });
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();

    // 1. Update active sessions (Upsert)
    await client.query(`
      INSERT INTO active_sessions (session_id, last_active) 
      VALUES ($1, NOW()) 
      ON CONFLICT (session_id) 
      DO UPDATE SET last_active = NOW()
    `, [sessionId]);

    // 2. Increment total views if new visit
    if (isNewVisit === 'true') {
      await client.query(`
        UPDATE site_stats 
        SET total_views = total_views + 1 
        WHERE id = 1
      `);
    }

    // 3. Clean up inactive sessions (older than 1 minute)
    await client.query(`
      DELETE FROM active_sessions 
      WHERE last_active < NOW() - INTERVAL '1 minute'
    `);

    // 4. Get active users count
    const activeRes = await client.query(`
      SELECT COUNT(*) as count FROM active_sessions
    `);
    const activeUsers = parseInt(activeRes.rows[0].count, 10);

    // 5. Get total views
    const statsRes = await client.query(`
      SELECT total_views FROM site_stats WHERE id = 1
    `);
    const totalViews = statsRes.rows.length > 0 ? parseInt(statsRes.rows[0].total_views, 10) : 0;

    await client.end();

    return res.status(200).json({ activeUsers, totalViews });
  } catch (err) {
    console.error('Database error in ping:', err);
    try {
      await client.end();
    } catch(e) {}
    return res.status(500).json({ error: 'Database error' });
  }
}
