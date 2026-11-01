import { createServer } from 'node:http';
import { db } from './db.js';

createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'GET' && req.url === '/health') {
    db.prepare('SELECT 1').get();
    res.end(JSON.stringify({ status: 'ok' }));
  } else if (req.method === 'GET' && req.url === '/items') {
    res.end(JSON.stringify(db.prepare('SELECT id, name FROM items ORDER BY id').all()));
  } else {
    res.writeHead(404).end(JSON.stringify({ error: 'Not found' }));
  }
}).listen(3000, '0.0.0.0');
