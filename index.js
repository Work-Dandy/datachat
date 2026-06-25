const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());
app.use(express.static('public'));

const Database = require('better-sqlite3');
const db = new Database(':memory:');

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

const currentYear = new Date().getFullYear();

const systemPrompt = `
You are a SQL expert. You query a SQLite database with the following table:

Table: enrolments
Columns:
- id INTEGER
- year INTEGER (ranges from ${currentYear - 5} to ${currentYear})
- programme TEXT (e.g. 'Computer Science', 'Nursing', 'Law')
- faculty TEXT (one of: 'Science', 'Arts', 'Business', 'Engineering', 'Law', 'Health')
- student_count INTEGER

The current year is ${currentYear}.
When the user says "this year" use ${currentYear}.
When the user says "last 5 years" use years ${currentYear - 5} to ${currentYear}.
When the user says "last year" use ${currentYear - 1}.

Example queries:
- Total students per faculty: SELECT faculty, SUM(student_count) as total FROM enrolments GROUP BY faculty
- Enrolments over time: SELECT year, SUM(student_count) as total FROM enrolments GROUP BY year ORDER BY year
- Top programmes: SELECT programme, SUM(student_count) as total FROM enrolments GROUP BY programme ORDER BY total DESC LIMIT 5

Rules:
- Only return a valid SQLite SQL query, nothing else
- No markdown, no explanation, no backticks
- Only SELECT statements
`;

app.post('/chat', async (req, res) => {
  const { message, history = [] } = req.body;

  try {
    // Build message history for follow up questions
    const messages = [
      ...history,
      { role: 'user', content: message }
    ];

    // Call OpenRouter
    const aiResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`
      },
      body: JSON.stringify({
        model: 'openai/gpt-3.5-turbo',
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages
        ]
      })
    });

    const aiData = await aiResponse.json();
    const sql = aiData.choices[0].message.content.trim();

    console.log('Generated SQL:', sql);

    // Execute the SQL
    const results = db.prepare(sql).all();

    res.json({
      sql,
      results,
      history: [
        ...messages,
        { role: 'assistant', content: sql }
      ]
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Something went wrong', error: err.message });
  }
});

app.use(express.json());

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Create table
db.exec(`
  CREATE TABLE enrolments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    year INTEGER,
    programme TEXT,
    faculty TEXT,
    student_count INTEGER
  )
`);

// Generate dummy data
const faculties = ['Science', 'Arts', 'Business', 'Engineering', 'Law', 'Health'];
const programmes = {
  Science: ['Computer Science', 'Mathematics', 'Physics', 'Biology'],
  Arts: ['English', 'History', 'Philosophy', 'Media Studies'],
  Business: ['Accounting', 'Marketing', 'Finance', 'Management'],
  Engineering: ['Civil', 'Mechanical', 'Electrical', 'Software'],
  Law: ['Criminal Law', 'Commercial Law', 'International Law'],
  Health: ['Nursing', 'Medicine', 'Pharmacy', 'Physiotherapy']
};

const insert = db.prepare(`
  INSERT INTO enrolments (year, programme, faculty, student_count)
  VALUES (?, ?, ?, ?)
`);

for (let year = currentYear - 5; year <= currentYear; year++) {
  for (const faculty of faculties) {
    for (const programme of programmes[faculty]) {
      const count = Math.floor(Math.random() * 450) + 50;
      insert.run(year, programme, faculty, count);
    }
  }
}

console.log('Database seeded');
