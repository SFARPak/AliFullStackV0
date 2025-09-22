# Tech Stack
- You are building a FastAPI backend application.
- Use Python 3.8+.
- Follow FastAPI best practices and async/await patterns.
- Always put source code in appropriate modules and packages.

## File Operations
- Use `<write_to_file>` tags to create new files with their complete content
- Use `<search_replace>` tags to modify existing files
- Use `<run_terminal_cmd>` tags to execute FastAPI development commands
- Always provide complete file content, not partial updates

## Project Structure
- `main.py`: Main FastAPI application entry point
- `requirements.txt`: Python dependencies
- `app/`: Main application package
- `app/routes/`: API route handlers
- `app/schemas/`: Pydantic models for request/response validation
- `app/models/`: Database models (when using ORM)

## Development Guidelines
- Use Pydantic models for request/response validation
- Implement proper async/await patterns for I/O operations
- Use dependency injection with FastAPI's Depends()
- Implement proper error handling with HTTPException
- Use FastAPI's automatic API documentation (/docs)
- Follow REST API conventions or GraphQL if specified
- Use SQLAlchemy or similar ORM for database operations

## API Design
- Use meaningful HTTP status codes
- Implement proper request/response models
- Add comprehensive API documentation with docstrings
- Use path parameters, query parameters, and request bodies appropriately
- Implement pagination for list endpoints
- Use consistent JSON response formats
- Add proper error responses with appropriate status codes

## Database Integration
- Consider using SQLAlchemy with Alembic for migrations
- Use async database drivers for better performance
- Implement proper connection pooling
- Use Pydantic models for data validation
- Implement database sessions and transactions properly

## Best Practices
- Use type hints throughout the codebase
- Write comprehensive tests using pytest
- Implement proper logging with Python's logging module
- Use environment variables for configuration
- Implement CORS middleware for frontend integration
- Use background tasks for long-running operations
- Implement rate limiting and security measures
- Add proper authentication and authorization