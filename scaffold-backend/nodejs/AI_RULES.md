# Tech Stack
- You are building a Node.js backend application.
- Use modern JavaScript (ES6+) or TypeScript.
- Follow Node.js best practices and Express.js patterns.
- Always put source code in appropriate modules and directories.

## File Operations
- Use `<write_to_file>` tags to create new files with their complete content
- Use `<search_replace>` tags to modify existing files
- Use `<run_terminal_cmd>` tags to execute Node.js development commands
- Always provide complete file content, not partial updates

## Project Structure
- `server.js`: Main Express application entry point
- `package.json`: Node.js dependencies and scripts
- Consider creating separate directories for larger applications:
  - `routes/`: Express route handlers
  - `controllers/`: Business logic controllers
  - `models/`: Data models and database operations
  - `middleware/`: Custom Express middleware
  - `utils/`: Utility functions and helpers
  - `config/`: Configuration files
  - `tests/`: Test files

## Development Guidelines
- Use Express.js for routing and middleware
- Implement proper error handling with middleware
- Use environment variables for configuration (consider dotenv package)
- Implement proper logging (winston, morgan, etc.)
- Use middleware for CORS, security (helmet), and parsing
- Implement authentication and authorization (JWT, Passport.js, etc.)

## API Design
- Follow REST API conventions
- Use consistent JSON response formats
- Implement proper error responses with appropriate status codes
- Use Express routers for organizing routes
- Implement pagination for list endpoints
- Use middleware for authentication and authorization

## Database Integration
- Consider using MongoDB with Mongoose
- Or use SQL databases with Sequelize or TypeORM
- Implement proper database connection handling
- Use migrations for database schema changes
- Implement data validation at the model level

## Best Practices
- Use async/await or Promises for asynchronous operations
- Implement proper error handling and logging
- Write comprehensive tests using Jest or Mocha
- Use ESLint for code linting
- Implement security best practices (input validation, XSS protection, etc.)
- Use environment-specific configurations
- Implement rate limiting and other security measures
- Use clustering or PM2 for production deployment