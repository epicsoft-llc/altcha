FROM node:24-alpine AS dependencies

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:24-alpine

ARG IMAGE_TAG="local"
ARG BUILD_DATE="development"
LABEL org.label-schema.name="ALTCHA service" \
      org.label-schema.description="Self-hosted ALTCHA challenge, verification and form mail service with an admin web UI" \
      org.label-schema.vendor="epicsoft LLC / Alexander Schwarz <info@epicsoft.one>" \
      org.label-schema.url="https://gitlab.com/epicsoft-networks/altcha" \
      org.label-schema.vcs-url="https://gitlab.com/epicsoft-networks/altcha/tree/main" \
      org.label-schema.version=${IMAGE_TAG} \
      org.label-schema.schema-version="1.0" \
      org.label-schema.build-date=${BUILD_DATE}

LABEL image.name="epicsoft_altcha" \
      image.description="Self-hosted ALTCHA challenge, verification and form mail service with an admin web UI" \
      maintainer="epicsoft LLC" \
      maintainer.name="Alexander Schwarz <info@epicsoft.one>" \
      maintainer.url="https://epicsoft.one/" \
      maintainer.copyright="Copyright 2026 epicsoft LLC / Alexander Schwarz" \
      license="MIT"

ENV IMAGE_TAG=${IMAGE_TAG}
ENV NODE_ENV="production"
ENV TZ="UTC"
ENV PORT="8080"
ENV ADMIN_PORT="8081"
ENV DATA_DIR="/data"
ENV PUBLIC_URL=""
ENV TRUST_PROXY="0"
# HMAC_SECRET, ADMIN_PASSWORD, ADMIN_API_TOKEN and SMTP_PASSWORD are deliberately not declared here:
# a secret does not belong into an image layer, not even as an empty default.
ENV HMAC_SECRET_FILE=""
ENV ADMIN_USERNAME=""
ENV ADMIN_PASSWORD_FILE=""
ENV ADMIN_API_TOKEN_FILE=""
ENV ADMIN_PROXY_USER_HEADER=""
ENV ADMIN_TRUSTED_PROXIES=""
ENV ADMIN_ALLOWED_USERS=""
ENV ALTCHA_ALGORITHM="PBKDF2/SHA-256"
ENV ALTCHA_COST="5000"
ENV ALTCHA_COUNTER_MIN="5000"
ENV ALTCHA_COUNTER_MAX="10000"
ENV ALTCHA_EXPIRES="600"
ENV RATE_CHALLENGE_PER_IP="60"
ENV RATE_SUBMIT_PER_IP="10"
ENV RATE_VERIFY_PER_IP="3600"
ENV MAX_BODY_BYTES="32768"
ENV HONEYPOT_FIELD="website"
ENV STATS_RETENTION_DAYS="90"
ENV SMTP_HOST=""
ENV SMTP_PORT=""
ENV SMTP_SECURITY="starttls"
ENV SMTP_TLS_SERVERNAME=""
ENV SMTP_USERNAME=""
ENV SMTP_PASSWORD_FILE=""
ENV SMTP_FROM=""
ENV SMTP_FROM_NAME=""
ENV SMTP_HELO="altcha"
ENV SMTP_TIMEOUT="20"

# The service needs node and nothing else at runtime. npm, npx, yarn and corepack
# only add packages for an image scanner to report.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-* \
 && mkdir -p /data \
 && chown node:node /data

WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY ui ./ui

USER node
VOLUME ["/data"]
EXPOSE 8080 8081

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
            CMD ["node", "/app/src/healthcheck.js"]

CMD ["node", "/app/src/server.js"]
