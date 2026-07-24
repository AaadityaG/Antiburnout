from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import device_auth, settings, chat, chat_history, tips, activity, agent, music
from kb import kb_router

app = FastAPI(
    title="AntiBurnout API",
    description="Backend API for AntiBurnout desktop application",
    version="1.0.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(device_auth.router)
app.include_router(settings.router)
app.include_router(chat.router)
app.include_router(chat_history.router)
app.include_router(tips.router)
app.include_router(activity.router)
app.include_router(agent.router)
app.include_router(music.router)
app.include_router(kb_router)

@app.get("/")
async def root():
    return {"message": "AntiBurnout API is running"}

@app.get("/health")
async def health_check():
    return {"status": "healthy"}
