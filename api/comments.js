import pg from 'pg';
const { Client } = pg;

const MAX_AUTHOR_LEN = 20;
const MAX_CONTENT_LEN = 500;

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();

    // 최초 호출 시 테이블 자동 생성
    await client.query(`
      CREATE TABLE IF NOT EXISTS comments (
        id SERIAL PRIMARY KEY,
        author TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    if (req.method === 'POST') {
      // req.body가 문자열로 들어오는 환경(일부 런타임) 대응
      let body = req.body;
      if (typeof body === 'string') {
        try {
          body = JSON.parse(body);
        } catch {
          body = {};
        }
      }

      const author = (body?.author ?? '').toString().trim();
      const content = (body?.content ?? '').toString().trim();

      if (!author || !content) {
        await client.end();
        return res.status(400).json({ error: '작성자와 내용을 모두 입력해주세요.' });
      }
      if (author.length > MAX_AUTHOR_LEN || content.length > MAX_CONTENT_LEN) {
        await client.end();
        return res.status(400).json({
          error: `작성자는 ${MAX_AUTHOR_LEN}자, 내용은 ${MAX_CONTENT_LEN}자 이내로 입력해주세요.`,
        });
      }

      const insertRes = await client.query(
        'INSERT INTO comments (author, content) VALUES ($1, $2) RETURNING id, author, content, created_at',
        [author, content]
      );
      await client.end();

      const row = insertRes.rows[0];
      return res.status(201).json({
        id: row.id,
        author: row.author,
        content: row.content,
        created_at: row.created_at.toISOString(),
      });
    }

    // GET: 최신순으로 반환
    const result = await client.query(
      'SELECT id, author, content, created_at FROM comments ORDER BY created_at DESC, id DESC'
    );
    await client.end();

    const comments = result.rows.map((row) => ({
      id: row.id,
      author: row.author,
      content: row.content,
      created_at: row.created_at.toISOString(),
    }));

    return res.status(200).json(comments);
  } catch (err) {
    console.error('Database error in comments:', err);
    try {
      await client.end();
    } catch {
      /* noop */
    }
    return res.status(500).json({ error: 'Database error' });
  }
}
