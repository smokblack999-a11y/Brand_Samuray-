FROM python:3.13-slim
WORKDIR /app
RUN pip install --no-cache-dir fastapi==0.116.1 uvicorn[standard]==0.35.0
COPY main.py .
RUN useradd --create-home --uid 10002 sandbox && chown -R sandbox:sandbox /app
USER sandbox
EXPOSE 8891
CMD ["uvicorn","main:app","--host","0.0.0.0","--port","8891"]
