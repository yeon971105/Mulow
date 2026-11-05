# Manual owner-reviewed build only. No app-driven provisioning or mutable image approval.
ARG NODE_BASE
FROM ${NODE_BASE}
ARG NODE_BASE
RUN node -e "if(!/@sha256:[a-f0-9]{64}$/.test(process.argv[1]))process.exit(1);require('node:sqlite').DatabaseSync" "${NODE_BASE}"
ARG TRUSTED_SOURCE_SHA256
LABEL org.musepilot.profile="react-node-sqlite-v1"
LABEL org.musepilot.trusted-source-sha256="${TRUSTED_SOURCE_SHA256}"
LABEL org.musepilot.node-sqlite="verified-build"
COPY vendor/node_modules/ /opt/runtime/node_modules/
COPY idle.mjs build.mjs serve.mjs bridge.mjs database.mjs /opt/runtime/
USER 10001:10001
WORKDIR /out
ENTRYPOINT ["node","/opt/runtime/idle.mjs"]
