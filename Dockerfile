# For running later on a home server (e.g. alongside Home Assistant).
# docker build -t emergency-hub . && docker run -d -p 8765:8765 -v /path/to/data:/app/data emergency-hub
FROM python:3.12-slim
WORKDIR /app
COPY server.py VERSION ./
COPY static ./static
COPY demo ./demo
ENV EHC_NO_SELF_UPDATE=1 EHC_HOST=0.0.0.0 EHC_PORT=8765 EHC_NO_BROWSER=1 EHC_DATA_DIR=/app/data EHC_CONFIG=/app/data/config.json
EXPOSE 8765
CMD ["python", "server.py"]
