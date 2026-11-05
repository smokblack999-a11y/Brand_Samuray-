FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .
RUN useradd -r -u 10001 x10 && mkdir -p /data && chown -R x10:x10 /data
USER x10
EXPOSE 8080
CMD ["python","app.py"]
