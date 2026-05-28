"""
Rooms — collaborative reading room management.
Each room has a unique code, a shared document, and a group of members.
"""
import random
import string
import time
from dataclasses import dataclass, field
from typing import Optional
from fastapi import WebSocket

# ── Random name generation ────────────────────────────────────────────────────
ADJECTIVES = [
    "Swift", "Bright", "Bold", "Calm", "Wise", "Epic", "Cool", "Kind",
    "Smart", "Sharp", "Quick", "Eager", "Sunny", "Happy", "Brave", "Zesty",
]
NOUNS = [
    "Reader", "Scholar", "Thinker", "Learner", "Explorer", "Seeker",
    "Student", "Wizard", "Coder", "Dreamer", "Helper", "Finder",
]

def generate_username() -> str:
    return f"{random.choice(ADJECTIVES)}{random.choice(NOUNS)}{random.randint(10, 99)}"

def generate_room_code() -> str:
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=6))

# ── Member ─────────────────────────────────────────────────────────────────────
@dataclass
class RoomMember:
    user_id: str
    name: str
    websocket: Optional[WebSocket] = field(default=None, repr=False)
    joined_at: float = field(default_factory=time.time)
    is_host: bool = False

# ── Room message ───────────────────────────────────────────────────────────────
@dataclass
class RoomMessage:
    msg_id: str
    user_id: str
    user_name: str
    content: str
    is_ai: bool = False
    timestamp: float = field(default_factory=time.time)

    def to_dict(self) -> dict:
        return {
            "msg_id": self.msg_id,
            "user_id": self.user_id,
            "user_name": self.user_name,
            "content": self.content,
            "is_ai": self.is_ai,
            "timestamp": self.timestamp,
        }

# ── Room ───────────────────────────────────────────────────────────────────────
class Room:
    MAX_MESSAGES = 100

    def __init__(self, code: str, session_id: str, file_bytes: bytes,
                 filename: str, file_type: str, host_id: str, host_name: str):
        self.code = code
        self.session_id = session_id
        self.file_bytes = file_bytes
        self.filename = filename
        self.file_type = file_type
        self.created_at = time.time()
        self.members: dict[str, RoomMember] = {}
        self.messages: list[RoomMessage] = []
        self._msg_counter = 0

        # Add host as first member
        self.members[host_id] = RoomMember(
            user_id=host_id, name=host_name, is_host=True
        )

    def add_member(self, user_id: str, name: str, ws: WebSocket) -> RoomMember:
        if user_id in self.members:
            self.members[user_id].websocket = ws
        else:
            self.members[user_id] = RoomMember(
                user_id=user_id, name=name, websocket=ws
            )
        return self.members[user_id]

    def remove_member(self, user_id: str):
        if user_id in self.members:
            self.members[user_id].websocket = None

    def get_online_members(self) -> list[dict]:
        return [
            {"user_id": m.user_id, "name": m.name, "is_host": m.is_host}
            for m in self.members.values()
            if m.websocket is not None
        ]

    def add_message(self, user_id: str, user_name: str, content: str, is_ai: bool = False) -> RoomMessage:
        self._msg_counter += 1
        msg = RoomMessage(
            msg_id=f"{self.code}-{self._msg_counter}",
            user_id=user_id,
            user_name=user_name,
            content=content,
            is_ai=is_ai,
        )
        self.messages.append(msg)
        # Keep only last MAX_MESSAGES
        if len(self.messages) > self.MAX_MESSAGES:
            self.messages = self.messages[-self.MAX_MESSAGES:]
        return msg

    async def broadcast(self, data: dict, exclude_user_id: Optional[str] = None):
        """Send a message to all connected WebSocket members."""
        import json
        dead = []
        for uid, member in self.members.items():
            if uid == exclude_user_id:
                continue
            if member.websocket is not None:
                try:
                    await member.websocket.send_text(json.dumps(data))
                except Exception:
                    dead.append(uid)
        for uid in dead:
            self.members[uid].websocket = None

    def to_info(self) -> dict:
        return {
            "code": self.code,
            "session_id": self.session_id,
            "filename": self.filename,
            "file_type": self.file_type,
            "member_count": len([m for m in self.members.values() if m.websocket is not None]),
            "created_at": self.created_at,
        }

# ── Room Manager ───────────────────────────────────────────────────────────────
class RoomManager:
    def __init__(self):
        self._rooms: dict[str, Room] = {}

    def create_room(self, session_id: str, file_bytes: bytes,
                    filename: str, file_type: str,
                    host_id: str, host_name: str) -> Room:
        # Generate unique code
        code = generate_room_code()
        while code in self._rooms:
            code = generate_room_code()

        room = Room(code, session_id, file_bytes, filename, file_type, host_id, host_name)
        self._rooms[code] = room
        return room

    def get_room(self, code: str) -> Optional[Room]:
        return self._rooms.get(code.upper())

    def delete_room(self, code: str):
        self._rooms.pop(code.upper(), None)

# Global singleton
room_manager = RoomManager()
