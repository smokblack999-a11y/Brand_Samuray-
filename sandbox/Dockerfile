FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends bubblewrap git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY main.py .
RUN useradd --create-home --uid 10002 sandbox && chown -R sandbox:sandbox /app
USER sandbox
EXPOSE 8891
CMD ["python","main.py"]
