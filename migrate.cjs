const fs = require('fs');
const readline = require('readline');
const { Client } = require('pg');
require('dotenv').config();

async function migrate() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  await client.connect();
  console.log('Connected to Neon DB');

  const fileStream = fs.createReadStream('public/local_db.jsonl');
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let count = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const data = JSON.parse(line);
      await client.query(
        'INSERT INTO member_counts (timestamp, count) VALUES ($1, $2) ON CONFLICT (timestamp) DO NOTHING',
        [data.timestamp, data.count]
      );
      count++;
    } catch (e) {
      console.error('Error processing line:', line, e.message);
    }
  }

  console.log(`Migration complete. Inserted/Checked ${count} records.`);
  await client.end();
}

migrate().catch(console.error);
