const fs = require('fs');
const path = require('path');

const API_URL = "https://script.google.com/macros/s/AKfycbzVncXUtzfxlpmfD0ufVNnXkTcVMCI7-ERzWZZDqiK40Roah1hkxfFq9PIvfjdMwh2seQ/exec";
const DB_FILE = path.join(__dirname, 'public', 'local_db.jsonl'); // Use .jsonl (JSON Lines) in public directory

async function fetchData() {
  try {
    const response = await fetch(API_URL);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    const currentCount = data.memberCount;
    
    // Create JSON Line record
    const record = {
      timestamp: new Date().toISOString(),
      count: currentCount
    };
    
    // Append to file with newline
    fs.appendFileSync(DB_FILE, JSON.stringify(record) + '\n');
    console.log(`[${record.timestamp}] Saved count: ${currentCount}`);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error fetching data:`, error.message);
  }
}

// Fetch immediately and then every 1 minute
fetchData();
setInterval(fetchData, 60000);
console.log("Data collector started. Appending to local_db.jsonl every minute...");
console.log("You can monitor it using: tail -f local_db.jsonl");
