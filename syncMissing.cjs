require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');
const readline = require('readline');

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  
  const res = await client.query('SELECT timestamp FROM member_counts');
  const existingSet = new Set(res.rows.map(r => r.timestamp.toISOString()));

  const fileStream = fs.createReadStream('public/local_db.jsonl');
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let added = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const { timestamp, count } = JSON.parse(line);
      const tsMs = new Date(timestamp).getTime();
      let found = false;
      for (const exTs of existingSet) {
        if (new Date(exTs).getTime() === tsMs) {
          found = true;
          break;
        }
      }
      if (!found) {
        await client.query('INSERT INTO member_counts (timestamp, count) VALUES ($1, $2)', [timestamp, count]);
        added++;
        console.log(`Added missing record: ${timestamp} - ${count}`);
      }
    } catch (e) {
      console.error("Error parsing line", e);
    }
  }

  console.log(`Done syncing. Added ${added} missing records.`);
  await client.end();
}

run().catch(console.error);
