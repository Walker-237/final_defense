# syntax=docker/dockerfile:1
# ───────────── Etape 1 — build Angular SSR (Node 22) ─────────────
FROM node:22-slim AS build
WORKDIR /app

# Cache des dependances : on copie d'abord les manifestes seuls.
# Le cache BuildKit du registre npm (/root/.npm) survit entre builds : meme
# apres un `docker builder prune`, `npm ci` ne retelecharge pas tout.
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

# Copie du code reel puis build (outputMode "server" => dist/frontend/{browser,server}).
# Le cache incrementiel Angular (/app/.angular/cache) est monte en cache BuildKit
# persistant : une recompilation apres une simple modif de code passe de ~95 s a
# ~15-25 s (Angular ne recompile que ce qui a change).
COPY . .
RUN --mount=type=cache,target=/app/.angular/cache npm run build

# ───────────── Etape 2 — image d'execution minimale ─────────────
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Execution sous un utilisateur non-root (principe du moindre privilege).
RUN useradd --system --no-create-home --uid 10001 appuser

# Le bundle server.mjs est autonome (Express et deps bundles) : on ne copie
# que le resultat du build, pas de node_modules au runtime.
COPY --from=build /app/dist/frontend ./dist/frontend

USER appuser
ENV PORT=4000
EXPOSE 4000

# Le serveur SSR n'expose pas de route /health dediee : on sonde la racine.
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
    CMD node -e "fetch('http://localhost:'+(process.env.PORT||4000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/frontend/server/server.mjs"]
