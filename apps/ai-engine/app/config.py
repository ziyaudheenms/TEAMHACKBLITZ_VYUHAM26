"""Configuration settings for BizContext AI Engine."""

from typing import Optional
import os
import sys
from pathlib import Path
from dotenv import load_dotenv
from pydantic_settings import BaseSettings, SettingsConfigDict

# Suppress banner in production / CLI logs
os.environ.setdefault("PYDANTIC_AI_NO_BANNER", "1")

# Ensure the app package is discoverable on sys.path
_AI_ENGINE_DIR = Path(__file__).resolve().parent.parent
if str(_AI_ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(_AI_ENGINE_DIR))

# Attempt to load .env from apps/ai-engine/.env and root .env
_LOCAL_ENV = _AI_ENGINE_DIR / ".env"
_ROOT_ENV = _AI_ENGINE_DIR.parent.parent / ".env"

if _LOCAL_ENV.exists():
    load_dotenv(dotenv_path=_LOCAL_ENV)
if _ROOT_ENV.exists():
    load_dotenv(dotenv_path=_ROOT_ENV)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", str(_LOCAL_ENV), str(_ROOT_ENV)),
        env_file_encoding="utf-8",
        extra="ignore"
    )

    # Gemini & AI Providers
    gemini_api_key: Optional[str] = None
    google_api_key: Optional[str] = None
    gemini_model: str = "gemini-2.5-flash"
    primary_chat_model: Optional[str] = None

    # Backend API (Node/Hono server)
    backend_api_base_url: str = "http://localhost:3001"
    backend_service_token: Optional[str] = None
    backend_request_timeout_seconds: float = 30.0

    # Web access tools (browser tier B1: read-only). Comma-separated domain allow-list;
    # empty means any public (non-private) host is allowed.
    web_allowed_domains: Optional[str] = None
    web_fetch_max_bytes: int = 1_000_000
    council_agent_timeout_seconds: float = 90.0

    # Service Configuration
    ai_engine_port: int = 8000
    ai_engine_host: str = "0.0.0.0"
    log_level: str = "info"
    enable_test_model_fallback: bool = True

    @property
    def effective_gemini_api_key(self) -> Optional[str]:
        """Resolves the Gemini API key from GEMINI_API_KEY or GOOGLE_API_KEY or environment."""
        return (
            self.gemini_api_key
            or self.google_api_key
            or os.getenv("GEMINI_API_KEY")
            or os.getenv("GOOGLE_API_KEY")
        )

    @property
    def effective_model_name(self) -> str:
        """Returns the model name to use for Gemini harness."""
        if self.gemini_model:
            return self.gemini_model
        if self.primary_chat_model and "gemini" in self.primary_chat_model.lower():
            return self.primary_chat_model
        return "gemini-2.5-flash"


settings = Settings()
