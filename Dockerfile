FROM --platform=${BUILDPLATFORM} node:24@sha256:8530f76a96d88820d288761f022e318970dda93d01536919fbc16076b7983e63 AS build

WORKDIR /opt/node_app

COPY . .

# do not ignore optional dependencies:
# Error: Cannot find module @rollup/rollup-linux-x64-gnu
RUN --mount=type=cache,target=/root/.cache/yarn \
    npm_config_target_arch=${TARGETARCH} yarn --frozen-lockfile --network-timeout 600000

ARG NODE_ENV=production

# The app's build needs more heap than Node's default (about 2 GB): the bundle
# is large and the source maps are bigger. Without this the build inside the
# container dies with "Reached heap limit - JavaScript heap out of memory",
# while the same build on a developer's machine succeeds.
ENV NODE_OPTIONS=--max-old-space-size=4096

# The VS Code bridge runs on the HOST - the extension lives inside the
# editor, and the editor lives on the teacher's machine. So the container
# reaches it through Docker's name for the host, and the URL is a BUILD-time
# variable: the app's bundle is built with it, so it has to be an ARG and an
# ENV here, not a runtime one (D-152).
ARG VITE_APP_BRIDGE_URL=ws://host.docker.internal:47511
ENV VITE_APP_BRIDGE_URL=$VITE_APP_BRIDGE_URL

RUN npm_config_target_arch=${TARGETARCH} yarn build:app:docker

FROM nginx:stable-alpine-slim@sha256:2c605dbeab79a6b2a63340474fe58119d0ef95bdc4b1f41df0aa689659b3d13b

COPY --from=build /opt/node_app/excalidraw-app/build /usr/share/nginx/html

HEALTHCHECK CMD wget -q -O /dev/null http://localhost || exit 1
