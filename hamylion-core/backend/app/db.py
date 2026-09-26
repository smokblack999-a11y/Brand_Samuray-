from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from .config import settings

engine = create_async_engine(settings.DATABASE_URL, pool_pre_ping=True, pool_recycle=1800)
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
