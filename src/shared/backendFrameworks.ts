export interface BackendFramework {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  language: string;
}

export const backendFrameworksData: BackendFramework[] = [
  {
    id: "django",
    title: "Django",
    description: "High-level Python web framework that encourages rapid development and clean, pragmatic design.",
    imageUrl: "assets/backend-frameworks/django-screenshot.svg",
    language: "Python",
  },
  {
    id: "fastapi",
    title: "FastAPI",
    description: "Modern, fast web framework for building APIs with Python 3.7+ based on standard Python type hints.",
    imageUrl: "assets/backend-frameworks/fastapi-screenshot.svg",
    language: "Python",
  },
  {
    id: "flask",
    title: "Flask",
    description: "Lightweight WSGI web application framework designed to make getting started quick and easy.",
    imageUrl: "assets/backend-frameworks/flask-screenshot.svg",
    language: "Python",
  },
  {
    id: "nodejs",
    title: "Node.js + Express",
    description: "JavaScript runtime built on Chrome's V8 JavaScript engine with Express.js web application framework.",
    imageUrl: "assets/backend-frameworks/nodejs-screenshot.svg",
    language: "JavaScript",
  },
];