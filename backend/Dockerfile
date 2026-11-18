FROM python:3.12-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    libpq-dev \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy pyproject.toml first for layer caching
COPY backend/pyproject.toml .
RUN pip install --upgrade pip && pip install .

# Copy application files
COPY backend/app ./app
COPY backend/alembic ./alembic
COPY backend/alembic.ini .
COPY form-definitions ./form-definitions

# Expose backend port
EXPOSE 8000

# Entrypoint runs uvicorn with configurable workers
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers ${WEB_CONCURRENCY:-4}"]
