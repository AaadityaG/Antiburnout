import os
from dotenv import load_dotenv

load_dotenv()

MONGODB_URI = os.getenv("MONGODB_URI")
MONGODB_DB_NAME = os.getenv("MONGODB_DB_NAME", "app_local")

USE_MONGO = False
client = None
mongo_db = None
users_collection = None
settings_collection = None
chat_history_collection = None
activity_collection = None

_mem_users = []
_mem_settings = {}
_mem_chat_history = []
_mem_activity = []

_DB_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "local_db.json")


def _persist():
    if USE_MONGO:
        return
    import json as _json
    with open(_DB_FILE, "w", encoding="utf-8") as f:
        _json.dump(
            {"users": _mem_users, "settings": _mem_settings, "chat_history": _mem_chat_history, "activity": _mem_activity},
            f, indent=2, default=str,
        )


print(f"Connecting to MongoDB...")
print(f"URI: {MONGODB_URI[:20] if MONGODB_URI else 'N/A'}...****")
print(f"Database: {MONGODB_DB_NAME}")

try:
    from pymongo import MongoClient
    client = MongoClient(
        MONGODB_URI,
        serverSelectionTimeoutMS=10000,
        connectTimeoutMS=10000,
        socketTimeoutMS=10000,
        tls=True,
        tlsAllowInvalidCertificates=False,
        retryWrites=True,
        w="majority"
    )
    client.admin.command('ping')
    mongo_db = client[MONGODB_DB_NAME]

    users_collection = mongo_db["users"]
    settings_collection = mongo_db["settings"]
    chat_history_collection = mongo_db["chatbot-history"]
    activity_collection = mongo_db["activity"]

    users_collection.create_index("device_id", unique=True)
    users_collection.create_index("email")
    settings_collection.create_index("user_id", unique=True)
    chat_history_collection.create_index("user_id")
    chat_history_collection.create_index("created_at")
    activity_collection.create_index([("user_id", 1), ("date", -1)])

    USE_MONGO = True
    print(f"[OK] MongoDB Connected Successfully!")
    print(f"[OK] Database: {MONGODB_DB_NAME}")
    print(f"[OK] Collections: users, settings")
except Exception as e:
    print(f"[WARN] MongoDB Connection Failed: {str(e)[:80]}")
    print(f"[WARN] Using file-backed storage (data persists in local_db.json)")

    import json as _json

    def _load_db():
        if os.path.exists(_DB_FILE):
            with open(_DB_FILE, "r", encoding="utf-8") as f:
                return _json.load(f)
        return {"users": [], "settings": {}, "chat_history": [], "activity": []}

    def _save_db(data):
        with open(_DB_FILE, "w", encoding="utf-8") as f:
            _json.dump(data, f, indent=2, default=str)

    _db_data = _load_db()
    _mem_users = _db_data["users"]
    _mem_settings = _db_data["settings"]
    _mem_chat_history = _db_data.get("chat_history", [])
    _mem_activity = _db_data.get("activity", [])
