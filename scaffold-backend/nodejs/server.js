const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.get('/', (req, res) => {
  res.json({ message: 'Node.js backend API is running' });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// API routes
app.get('/api/items', (req, res) => {
  // Mock data - replace with database queries
  const items = [
    { id: 1, name: 'Sample Item 1', description: 'A sample item', price: 29.99 },
    { id: 2, name: 'Sample Item 2', description: 'Another sample item', price: 49.99 }
  ];
  res.json(items);
});

app.post('/api/items', (req, res) => {
  const { name, description, price } = req.body;

  // Basic validation
  if (!name || !price) {
    return res.status(400).json({ error: 'Name and price are required' });
  }

  // Mock response - replace with database insertion
  const newItem = {
    id: Date.now(), // Simple ID generation
    name,
    description,
    price: parseFloat(price)
  };

  res.status(201).json(newItem);
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.listen(port, () => {
  console.log(\`Server running on http://localhost:\${port}\`);
});

module.exports = app;