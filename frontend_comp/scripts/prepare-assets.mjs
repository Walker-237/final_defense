/**
 * Prépare les assets hors-ligne servis depuis `public/` :
 *   - MediaPipe FaceMesh (WASM)      → capture faciale + vivacité
 *   - face-api (modèles 128-d)       → empreinte pour la comparaison 1:1
 *   - Tesseract (worker + cœur WASM) → OCR de la pièce d'identité
 *
 * Ces fichiers pèsent ~57 Mo et sont **entièrement reproductibles** : la
 * quasi-totalité provient de `node_modules` (donc du lock file), et seuls deux
 * modèles sont téléchargés. Ils ne sont donc PAS versionnés — ce script les
 * régénère (`npm ci` puis `npm run prepare:assets`, appelé automatiquement
 * avant `build` et `test`).
 *
 * La CSP de l'application est `connect-src 'self'` : rien n'est chargé depuis un
 * CDN au runtime, tout est servi par notre propre origine.
 */
import { createWriteStream } from 'node:fs';
import { cp, mkdir, access, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const racine = join(dirname(fileURLToPath(import.meta.url)), '..');
const modules = join(racine, 'node_modules');
const publicDir = join(racine, 'public');

/** Copies depuis node_modules : source → destination (relative à public/). */
const COPIES = [
  // MediaPipe : runtime WASM (le modèle .task est téléchargé plus bas).
  { de: join(modules, '@mediapipe/tasks-vision/wasm'), vers: 'mediapipe/wasm' },

  // pdf.js : worker requis par convention-reader.ts (lecture de la convention).
  // Le pattern `new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)`
  // n'est pas repris par le bundler Angular/esbuild ; on le sert donc explicitement
  // depuis public/, au meme chemin que celui attendu par le code.
  { de: join(modules, 'pdfjs-dist/build/pdf.worker.min.mjs'), vers: 'pdfjs-dist/build/pdf.worker.min.mjs' },

  // face-api : uniquement les 3 réseaux utilisés (détection, repères, empreinte).
  ...['tiny_face_detector_model', 'face_landmark_68_model', 'face_recognition_model'].flatMap(
    (m) => [
      { de: join(modules, `@vladmandic/face-api/model/${m}-weights_manifest.json`), vers: `faceapi/${m}-weights_manifest.json` },
      { de: join(modules, `@vladmandic/face-api/model/${m}.bin`), vers: `faceapi/${m}.bin` },
    ],
  ),

  // Tesseract : worker + cœurs WASM (SIMD et repli non-SIMD).
  { de: join(modules, 'tesseract.js/dist/worker.min.js'), vers: 'tesseract/worker.min.js' },
  ...[
    'tesseract-core-simd-lstm.wasm', 'tesseract-core-simd-lstm.wasm.js',
    'tesseract-core-lstm.wasm', 'tesseract-core-lstm.wasm.js',
  ].map((f) => ({ de: join(modules, `tesseract.js-core/${f}`), vers: `tesseract/${f}` })),
];

/** Modèles non fournis par npm : téléchargés une fois, puis servis en local. */
const TELECHARGEMENTS = [
  {
    url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    vers: 'mediapipe/models/face_landmarker.task',
  },
  {
    url: 'https://raw.githubusercontent.com/naptha/tessdata/gh-pages/4.0.0_fast/fra.traineddata.gz',
    vers: 'tesseract/lang/fra.traineddata.gz',
  },
];

const existe = async (p) => access(p).then(() => true, () => false);

async function telecharger(url, destination) {
  if (await existe(destination)) {
    console.log(`  ✓ déjà présent : ${destination.replace(racine, '.')}`);
    return;
  }
  await mkdir(dirname(destination), { recursive: true });
  const reponse = await fetch(url);
  if (!reponse.ok) {
    throw new Error(`téléchargement échoué (${reponse.status}) : ${url}`);
  }
  // Écriture via un fichier temporaire : une interruption ne laisse jamais un
  // asset tronqué que le prochain lancement croirait valide.
  const tmp = `${destination}.part`;
  await pipeline(Readable.fromWeb(reponse.body), createWriteStream(tmp));
  await cp(tmp, destination);
  await rm(tmp);
  console.log(`  ↓ ${destination.replace(racine, '.')}`);
}

async function main() {
  console.log('Préparation des assets hors-ligne (MediaPipe · face-api · Tesseract)…');

  for (const { de, vers } of COPIES) {
    const destination = join(publicDir, vers);
    if (!(await existe(de))) {
      throw new Error(`source introuvable : ${de}\n→ lancez « npm ci » d'abord.`);
    }
    await mkdir(dirname(destination), { recursive: true });
    await cp(de, destination, { recursive: true });
  }
  console.log(`  ✓ ${COPIES.length} entrée(s) copiée(s) depuis node_modules`);

  for (const { url, vers } of TELECHARGEMENTS) {
    await telecharger(url, join(publicDir, vers));
  }

  console.log('Assets prêts.');
}

main().catch((e) => {
  console.error('Échec de la préparation des assets :', e.message);
  process.exit(1);
});
