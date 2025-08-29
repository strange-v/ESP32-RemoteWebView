FROM mcr.microsoft.com/playwright:v1.55.0-jammy

USER root
RUN apt-get update && apt-get install -y --no-install-recommends curl socat \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json /app/
RUN npm install --omit=dev
COPY server.js /app/

RUN mkdir -p /pw-data && chown -R pwuser:pwuser /pw-data
USER pwuser

ENV TARGET_URL=""
ENV VIEWPORT_W=480
ENV VIEWPORT_H=480
ENV TILE=32
ENV SCAN_INTERVAL_MS=200
ENV FULLFRAME_EVERY=50
ENV WS_PORT=8081
ENV DEBUG_PORT=9222
ENV HEALTH_PORT=8080
ENV USER_DATA_DIR=/pw-data

EXPOSE 8080 8081 9222
CMD ["node","/app/server.js"]
