# Run Emergency Hub Coordinator on a home server (for example alongside Home Assistant):
#   docker build -t emergency-hub . && docker run -d -p 8765:8765 -v /path/to/data:/app/data emergency-hub
# In Docker the app tells you about new versions but doesn't update itself: rebuild the image instead.
FROM python:3.12-slim
WORKDIR /opt/ehc
COPY app/server.py app/VERSION ./app/
COPY app/static ./app/static
COPY app/demo ./app/demo
ENV EHC_NO_SELF_UPDATE=1 EHC_HOST=0.0.0.0 EHC_PORT=8765 EHC_NO_BROWSER=1 EHC_DATA_DIR=/app/data EHC_CONFIG=/app/data/config.json
EXPOSE 8765
CMD ["python", "app/server.py"]
