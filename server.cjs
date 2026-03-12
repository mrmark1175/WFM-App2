const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(cors()); // This allows your Website to talk to this Server
app.use(express.json());

// 1. Connection to pgAdmin 4 / PostgreSQL
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'exordium_db', // Change this to your DB name in pgAdmin
  password: '837177',      // Change this to your pgAdmin password
  port: 5432,
});

app.get('/api/agents', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM agents'); 
    console.log("Data fetched successfully!");
    res.json(result.rows);
  } catch (err) {
    // THIS WILL PRINT THE REAL ERROR IN YOUR TERMINAL
    console.error("--- DATABASE ERROR DETAILS ---");
    console.error("Code:", err.code);
    console.error("Message:", err.message);
    console.error("------------------------------");
    
    res.status(500).json({ 
      error: "Database connection failed", 
      details: err.message 
    });
  }
});

app.listen(5000, () => {
  console.log('Backend Server is running on http://localhost:5000');
});