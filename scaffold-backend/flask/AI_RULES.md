# Tech Stack
- You are building a Flask backend application.
- Use Python 3.x.
- Follow Flask best practices and patterns.
- Always put source code in appropriate modules and packages.

## File Operations
- Use `<write_to_file>` tags to create new files with their complete content
- Use `<search_replace>` tags to modify existing files
- Use `<run_terminal_cmd>` tags to execute Flask development commands
- Always provide complete file content, not partial updates

## Project Structure
- `run.py`: Main Flask application entry point
- `requirements.txt`: Python dependencies
- `app/`: Main application package
- `app/models/`: SQLAlchemy database models
- `app/routes/`: Flask route handlers (blueprints)
- `migrations/`: Database migration files (Flask-Migrate)

## Development Guidelines
- Use Flask blueprints for larger applications to organize routes
- Implement proper error handling with Flask's error handlers
- Use Flask-WTF for form handling and validation
- Implement proper JSON responses for API endpoints
- Use Flask-SQLAlchemy or similar ORM for database operations

## API Design
- Use meaningful HTTP status codes
- Implement proper request/response handling
- Add comprehensive API documentation
- Use Flask-RESTful or similar extensions for complex APIs
- Implement authentication and authorization as needed
- Use consistent JSON response formats

## Database Integration
- Use SQLAlchemy with Flask-SQLAlchemy for ORM
- Use Flask-Migrate for database migrations
- Implement proper database connection handling
- Use database sessions and transactions properly

## Best Practices
- Use environment variables for configuration (consider python-dotenv)
- Implement proper logging with Flask's logger
- Write comprehensive tests using pytest or Flask's testing client
- Use Flask's before_request and after_request decorators for middleware-like functionality
- Implement CORS handling for frontend integration
- Use Flask's session management for user sessions
- Implement security measures (input validation, XSS protection, CSRF protection)