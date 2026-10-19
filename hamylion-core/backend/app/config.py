import os


class Settings:
    # No embedded database credentials: deployment must provide DATABASE_URL.
    DATABASE_URL = os.getenv("DATABASE_URL", "")
    REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
    BOOTSTRAP_API_KEY = os.getenv("HAMYLION_API_KEY", "")
    MAX_RETRIES = max(1, int(os.getenv("MAX_RETRIES", "5")))
    RETRY_BASE_SECONDS = max(1, int(os.getenv("RETRY_BASE_SECONDS", "2")))
    ACK_TIMEOUT_SECONDS = max(5, int(os.getenv("ACK_TIMEOUT_SECONDS", "60")))
    STREAM = os.getenv("HAMYLION_STREAM", "hamylion.events")
    GROUP = os.getenv("HAMYLION_GROUP", "hamylion-workers")


settings = Settings()
