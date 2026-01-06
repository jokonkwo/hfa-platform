# apps/api/Dockerfile
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# System deps (keep minimal)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install Python deps (pinned later; minimal for now)
RUN pip install --no-cache-dir --upgrade pip \
  && pip install --no-cache-dir fastapi uvicorn pydantic duckdb

# Copy only what the API needs
COPY configs ./configs
COPY apps/api/src ./apps/api/src
COPY pyproject.toml ./pyproject.toml

# Expose port
EXPOSE 8000

# Ensure Python can find the API package
ENV PYTHONPATH=/app/apps/api/src

CMD ["uvicorn", "hfa_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
