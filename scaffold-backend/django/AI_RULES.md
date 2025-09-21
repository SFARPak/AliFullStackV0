# Tech Stack
- You are building a Django backend application.
- Use Python 3.x.
- Follow Django best practices and conventions.
- Always put source code in the appropriate Django app folders.

## Project Structure
- `config/`: Main Django project directory containing settings
- `apps/`: Django applications directory
- `apps/core/`: Core functionality and models
- `apps/api/`: API endpoints and serializers
- `manage.py`: Django management commands
- `requirements.txt`: Python dependencies

## Development Guidelines
- Create Django apps for different features using `python manage.py startapp <app_name>`
- Use Django's ORM for database operations
- Implement proper URL routing in urls.py files
- Use Django REST Framework for API development
- Follow REST API conventions for API endpoints
- Use class-based views for complex logic

## Database
- Default database is SQLite (db.sqlite3)
- Use migrations for database schema changes: `python manage.py makemigrations` and `python manage.py migrate`
- Define models in models.py files within each app

## API Development
- Use Django REST Framework for API endpoints
- Implement serializers for data validation and transformation
- Use ViewSets for CRUD operations
- Implement proper authentication and permissions
- Add comprehensive API documentation

## Best Practices
- Use class-based views for complex logic
- Implement proper error handling and logging
- Use Django's forms for data validation
- Implement proper security measures (CSRF protection, authentication, authorization)
- Write comprehensive tests in tests.py files
- Use Django's caching framework for performance optimization