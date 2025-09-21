from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes import api

app = FastAPI(
    title="FastAPI Backend",
    description="A FastAPI backend application",
    version="1.0.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(api.router, prefix="/api", tags=["api"])

@app.get("/")
async def root():
    return {"message": "FastAPI Backend is running"}

@app.get("/health")
async def health_check():
    return {"status": "healthy"}