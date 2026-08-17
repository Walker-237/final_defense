import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express, { Request, Response, NextFunction } from 'express';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { connect as netConnect } from 'node:net';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

// ────────────────────────────── DURCISSEMENT SÉCURITÉ ──────────────────────────────

// Désactive l'empreinte serveur exposée par défaut
app.disable('x-powered-by');
app.set('trust proxy', 1);

/**
 * Durcissement HTTPS optionnel. À activer (FORCE_HTTPS=true) UNIQUEMENT
 * derrière un terminateur TLS. En HTTP simple (ex. accès direct par IP:port),
 * `upgrade-insecure-requests` ferait recharger les ressources en https sur un
 * port sans TLS → page blanche, et HSTS forcerait le https.
 */
const FORCE_HTTPS = process.env['FORCE_HTTPS'] === 'true';

/** Placeholder de nonce présent dans index.html (meta CSP + app-root). */
const NONCE_PLACEHOLDER = 'NG_CSP_NONCE_PLACEHOLDER';

/**
 * Construit la CSP. `scriptSrc` vaut `'self'` par défaut (réponses non-HTML :
 * aucun script inline) et `'self' 'nonce-…'` pour le HTML SSR (qui porte les
 * scripts inline d'hydratation/event-replay). Plus de `'unsafe-inline'` sur les
 * scripts : seule l'exécution des scripts portant le nonce du serveur est permise.
 */
function buildCsp(scriptSrc: string): string {
  return [
    "default-src 'self'",
    // 'wasm-unsafe-eval' : requis pour compiler le WASM de MediaPipe FaceMesh
    // (capture faciale du parcours d'inscription). N'autorise QUE le WebAssembly,
    // pas eval()/new Function() classiques (bien plus restreint que 'unsafe-eval').
    `script-src ${scriptSrc} 'wasm-unsafe-eval'`,
    // MediaPipe instancie son runtime dans un worker cree depuis un blob.
    "worker-src 'self' blob:",
    // style-src conserve 'unsafe-inline' : les styles n'exécutent pas de JS et
    // Tailwind/Angular en injectent au runtime. Pas de nonce requis ici.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    ...(FORCE_HTTPS ? ["upgrade-insecure-requests"] : [])
  ].join('; ');
}

/** Headers de sécurité appliqués à toutes les réponses (alternative légère à Helmet). */
app.use((req: Request, res: Response, next: NextFunction) => {
  // CSP de base (sans inline) ; le handler SSR la remplace par une CSP à nonce.
  res.setHeader('Content-Security-Policy', buildCsp("'self'"));
  if (FORCE_HTTPS) {
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  } else {
    // Révoque toute politique HSTS héritée d'un déploiement précédent : sans TLS
    // sur ce port, un HSTS résiduel forcerait le https et casserait le rendu.
    // max-age=0 demande au navigateur de supprimer l'entrée HSTS dès qu'il
    // atteint à nouveau l'origine (auto-réparation, sans purge manuelle).
    res.setHeader('Strict-Transport-Security', 'max-age=0');
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // camera=(self) : la capture faciale du parcours d'inscription a besoin de la
  // webcam, uniquement sur notre propre origine (aucun tiers).
  res.setHeader('Permissions-Policy', "geolocation=(), microphone=(), camera=(self), payment=(), usb=(), interest-cohort=()");
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.removeHeader('X-Powered-By');
  next();
});

/**
 * Limite la taille des corps de requête pour réduire le risque de DoS.
 *
 * Le téléversement de livrables (module M4) transmet le fichier encodé en
 * data-URI base64 dans le corps JSON : un fichier de 15 Mo pèse ~21 Mo une fois
 * encodé. La limite JSON doit donc dépasser cette taille, sinon le proxy /api
 * rejette l'upload (413) avant même d'atteindre le backend. Les formulaires
 * urlencodés restent bridés (aucun gros corps attendu sur ce canal).
 */
const JSON_BODY_LIMIT = process.env['JSON_BODY_LIMIT'] ?? '25mb';
app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

/** Bloque les méthodes HTTP non utilisées (TRACE/CONNECT) — défense contre cross-site tracing. */
app.use((req: Request, res: Response, next: NextFunction) => {
  const allowed = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
  if (!allowed.includes(req.method)) {
    res.status(405).set('Allow', allowed.join(', ')).end();
    return;
  }
  next();
});

/**
 * Proxy `/api` → backend Axum.
 *
 * Le navigateur ne dialogue qu'avec sa propre origine : la CSP stricte
 * `connect-src 'self'` reste respectée et aucun échange CORS n'est exposé.
 * Le relais serveur-à-serveur transmet le jeton `Authorization` tel quel.
 */
const API_TARGET = process.env['API_TARGET'] ?? 'http://localhost:8080';
app.use('/api', async (req: Request, res: Response) => {
  try {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (req.headers.authorization) headers['authorization'] = String(req.headers.authorization);
    // Propage l'IP REELLE du client au backend (le proxy la fixe lui-meme, donc
    // non falsifiable par le client). Sans cela, le backend verrait l'IP du
    // conteneur frontend pour tout le monde -> rate-limiting et audit inoperants.
    const clientIp = (req.ip ?? req.socket?.remoteAddress ?? '').replace(/^::ffff:/, '');
    if (clientIp) headers['x-forwarded-for'] = clientIp;
    // Relais du cookie (jeton de rafraichissement HttpOnly) vers le backend.
    if (req.headers.cookie) headers['cookie'] = String(req.headers.cookie);
    const hasBody = !['GET', 'HEAD'].includes(req.method);
    if (hasBody) headers['content-type'] = 'application/json';
    const upstream = await fetch(API_TARGET + req.originalUrl, {
      method: req.method,
      headers,
      body: hasBody ? JSON.stringify(req.body ?? {}) : undefined,
    });
    // Relais des cookies positionnes par le backend (Set-Cookie) vers le navigateur.
    const rawCookie = upstream.headers.get('set-cookie');
    const setCookies = typeof (upstream.headers as any).getSetCookie === 'function'
      ? (upstream.headers as any).getSetCookie() as string[]
      : rawCookie ? [rawCookie] : [];
    if (setCookies.length) res.setHeader('Set-Cookie', setCookies);
    const payload = await upstream.text();
    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/json');
    res.send(payload);
  } catch {
    res.status(502).json({ error: { code: 'BAD_GATEWAY', message: 'Backend injoignable.' } });
  }
});

/**
 * Relais bas niveau (TCP) de la poignee de main WebSocket vers le backend.
 *
 * Express ne gere pas l'evenement Node `upgrade` (le proxy `/api` ci-dessus
 * repose sur `fetch`, qui ne sait pas faire d'upgrade WebSocket). On
 * retransmet donc la requete HTTP d'origine telle quelle sur une connexion
 * TCP vers le backend, puis on relie les deux sockets. Cela garde le
 * WebSocket sur la MEME origine que la page — requis par la CSP stricte
 * (`connect-src 'self'`) et par le fait que le backend n'est pas expose
 * publiquement (cf. docker-compose.yml).
 */
const WS_PROXY_PREFIX = '/ws/chat/';

function proxyWebSocketUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
  if (!req.url || !req.url.startsWith(WS_PROXY_PREFIX)) {
    socket.destroy();
    return;
  }
  const target = new URL(API_TARGET);
  const upstream = netConnect({
    host: target.hostname,
    port: Number(target.port) || (target.protocol === 'https:' ? 443 : 80),
  });

  upstream.on('connect', () => {
    const requestLines = [`${req.method} ${req.url} HTTP/1.1`];
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      for (const v of Array.isArray(value) ? value : [value]) {
        requestLines.push(`${key}: ${v}`);
      }
    }
    requestLines.push('', '');
    upstream.write(requestLines.join('\r\n'));
    if (head && head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
}

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
    dotfiles: 'deny',
    setHeaders(res, path) {
      // Pas de cache pour le HTML afin de toujours servir la dernière CSP
      if (path.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      } else if (/\.(js|css|woff2?|svg|png|jpg|webp|ico|wasm|task|bin|gz)$/i.test(path)) {
        // wasm/task/bin/gz : runtimes et modeles hors-ligne (MediaPipe, face-api,
        // Tesseract, ~36 Mo) servis depuis public/ — immutable pour n'etre
        // telecharges qu'UNE fois par appareil, jamais revalides ensuite.
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  }),
);

/**
 * Handle all other requests by rendering the Angular application.
 *
 * Pour les réponses HTML, on génère un nonce CSP par requête : Angular l'a
 * apposé sur ses scripts inline (via `ngCspNonce`), on remplace le placeholder
 * par sa valeur dans le corps ET on pose la CSP `script-src 'nonce-…'`. Les
 * réponses non-HTML sont relayées telles quelles.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then(async (response) => {
      if (!response) return next();
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('text/html')) {
        return writeResponseToNodeResponse(response, res);
      }
      const nonce = randomBytes(16).toString('base64');
      const html = (await response.text()).split(NONCE_PLACEHOLDER).join(nonce);
      // Recopie les en-têtes de la réponse Angular, sauf ceux qu'on (re)définit.
      response.headers.forEach((value, key) => {
        const k = key.toLowerCase();
        if (k !== 'content-security-policy' && k !== 'content-length'
            && k !== 'content-type') {
          res.setHeader(key, value);
        }
      });
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Security-Policy', buildCsp(`'self' 'nonce-${nonce}'`));
      res.status(response.status).send(html);
    })
    .catch(next);
});

/** Gestionnaire d'erreurs final — masque les détails internes en production. */
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (process.env['NODE_ENV'] !== 'production') console.error(err);
  if (!res.headersSent) res.status(500).json({ error: 'Internal Server Error' });
});

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  const server = app.listen(port, (error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://localhost:${port}`);
  });
  server.on('upgrade', (req, socket, head) => proxyWebSocketUpgrade(req, socket, head));
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
