# The container

A student who does not want to install Node, Yarn and the app's dependencies can run the app in a **container** instead.

```bash
docker compose -f docker/docker-compose.yml up --build -d
```

Then open <http://localhost:3000>.

Stop it again with:

```bash
docker compose -f docker/docker-compose.yml down
```

## What the container does

- It **builds the app** and serves the built app with nginx, on port **3000** of the host (`http://localhost:3000`).
- It is the **app** only: the whiteboard, the panels, the code cards, the pages. Nothing else.

## What stays on the host

**The extension stays on the host.** The Excalidraw Bridge extension lives inside VS Code or VSCodium, on the teacher's own machine - it cannot live in a container, because it _is_ the editor's own process. So:

| what                             | where it runs                     |
| -------------------------------- | --------------------------------- |
| the app (the whiteboard)         | in the container                  |
| the extension (the bridge)       | on the host, inside the editor    |
| the extension's websocket server | on the host, on `127.0.0.1:47511` |

The container reaches the host's bridge over **`host.docker.internal`**, which is Docker's name for the host machine. The compose file therefore builds the app with:

```
VITE_APP_BRIDGE_URL=ws://host.docker.internal:47511
```

and the compose file gives the container that name for the host (`extra_hosts: host.docker.internal:host-gateway`), so it works on Linux as well as on Docker Desktop.

## Pointing it at the bridge yourself

The URL is a **build-time** variable: it is baked into the app's bundle when the image is built, which is why it is an `ARG` in the `Dockerfile` and an argument in the compose file. To change it, build again with another value:

```bash
docker compose -f docker/docker-compose.yml build \
  --build-arg VITE_APP_BRIDGE_URL=ws://host.docker.internal:47511
```

or, to use another port, change the `VITE_APP_BRIDGE_URL` line in `docker/docker-compose.yml` and rebuild.

The default (`ws://host.docker.internal:47511`) is the port the extension listens on by default, and it is the same port the app uses when it runs on the host. If the extension is on another port, change the URL to match it - and change the extension's `excalidraw-bridge.port` setting to the same number.

## What it will not do

- It does **not** put the extension in the container. The extension is installed on the host by the setup (`installer/setup.ps1` or `installer/setup.sh`).
- It does **not** need the host's Node, Yarn or `node_modules` - the image builds the app itself. It does need Docker.
- It does **not** run the app's development server. It serves the built app.
