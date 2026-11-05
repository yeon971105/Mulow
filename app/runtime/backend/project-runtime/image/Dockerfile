# Manual provisioning only. NODE_BASE MUST be owner-approved node image @sha256.
ARG NODE_BASE
FROM ${NODE_BASE}
ARG NODE_BASE
RUN node -e "if(!/@sha256:[a-f0-9]{64}$/.test(process.argv[1]))process.exit(1)" "${NODE_BASE}"
ARG TRUSTED_SOURCE_SHA256
LABEL org.musepilot.profile="react-node-http-v1"
LABEL org.musepilot.trusted-source-sha256="${TRUSTED_SOURCE_SHA256}"
COPY vendor/node_modules/ /opt/runtime/node_modules/
COPY idle.mjs build.mjs serve.mjs bridge.mjs /opt/runtime/
USER 10001:10001
WORKDIR /out
ENTRYPOINT ["node","/opt/runtime/idle.mjs"]
