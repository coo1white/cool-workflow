FROM --platform=linux/amd64 node:22-slim AS node22
WORKDIR /bench
COPY plugins/cool-workflow/dist/ /bench/dist/
COPY plugins/cool-workflow/apps/ /bench/apps/
COPY scripts/bench/ /bench/scripts/bench/
RUN mkdir -p /bench/workflows

FROM --platform=linux/amd64 node:18-slim AS node18
WORKDIR /bench
COPY plugins/cool-workflow/dist/ /bench/dist/
COPY plugins/cool-workflow/apps/ /bench/apps/
COPY scripts/bench/ /bench/scripts/bench/
RUN mkdir -p /bench/workflows
