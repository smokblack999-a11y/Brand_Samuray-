FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends bubblewrap git ca-certificates python3 python3-venv \
 && python3 -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir fastapi==0.116.1 uvicorn==0.35.0 \
 && rm -rf /var/lib/apt/lists/*
ENV PATH="/opt/venv/bin:${PATH}"
COPY main.py .
RUN useradd --create-home --uid 10002 sandbox && chown -R sandbox:sandbox /app
USER sandbox
EXPOSE 8891
CMD ["python","main.py"]
