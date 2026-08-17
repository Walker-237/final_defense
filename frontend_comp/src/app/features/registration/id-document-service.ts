import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/** Type de pièce reconnu. */
export type TypePiece = 'CNI' | 'PASSEPORT' | 'CARTE_SEJOUR';

/** Verdict d'analyse d'une pièce d'identité téléversée. */
export interface AnalysePiece {
  /** Vrai si l'image est exploitable (qualité). Le TYPE n'est plus une condition. */
  ok: boolean;
  /** Type reconnu si l'OCR y parvient — purement indicatif, jamais bloquant. */
  type: TypePiece | null;
  /** Motifs de refus, présentés tels quels à l'utilisateur. */
  motifs: string[];
  /** Mentions d'identité repérées (Nom, Date de naissance…). */
  champsDetectes: string[];
  largeur: number;
  hauteur: number;
  /** Netteté (variance du laplacien) — plus c'est haut, plus l'image est nette. */
  nettete: number;
  /** Texte OCR (tronqué) — transmis au back-office pour contrôle. */
  texte: string;
}

/** Résolution minimale exigée (une CNI photographiée de près dépasse largement). */
const LARGEUR_MIN = 600;
const HAUTEUR_MIN = 380;
/** Seuil de netteté : en dessous, l'image est floue (texte illisible). */
const NETTETE_MIN = 55;

/** Mentions qui identifient le TYPE de pièce. */
const MARQUEURS: Record<TypePiece, RegExp[]> = {
  CNI: [
    /carte\s*nationale\s*d.?\s*identite/i,
    /national\s*identity\s*card/i,
    /\bcarte\s*d.?\s*identite\b/i,
  ],
  PASSEPORT: [
    /\bpasse?[\s-]?port\b/i,
    // Ligne MRZ d'un passeport : « P< » suivi du code pays ISO (P<CMR…).
    // Sans le « < », le motif attraperait n'importe quel mot en P (« PRENOM »).
    /^P<[A-Z]{3}/m,
  ],
  CARTE_SEJOUR: [
    /(titre|carte)\s*de\s*sejour/i,
    /residence\s*permit/i,
  ],
};

/** Mentions attendues sur toute pièce d'identité (« on voit les infos dessus »). */
const CHAMPS: Array<{ cle: string; motif: RegExp }> = [
  { cle: 'Nom', motif: /\bnom\b|\bsurname\b/i },
  { cle: 'Prénom', motif: /\bpr[eé]noms?\b|\bgiven\s*names?\b/i },
  { cle: 'Date de naissance', motif: /naissance|date\s*of\s*birth|\bn[ée]\s*le\b/i },
  { cle: 'Sexe', motif: /\bsexe\b|\bsex\b/i },
  { cle: 'Nationalité', motif: /nationalit/i },
  { cle: 'Numéro', motif: /\bn[°o]\s*\d|\bno\b\s*\d|\d{6,}/i },
  { cle: 'Validité', motif: /valab|expir|delivr|issued/i },
  { cle: 'République', motif: /r[eé]publique|republic/i },
];

/**
 * Contrôle d'une pièce d'identité (CNI, carte de séjour, passeport).
 *
 * <p>Un seul contrôle <b>bloquant</b> : la <b>qualité</b> de l'image (résolution
 * suffisante et netteté), sans laquelle le document serait de toute façon
 * illisible.</p>
 *
 * <p>La reconnaissance automatique du type de pièce a été <b>retirée</b> :
 * l'OCR d'une photo de CNI est trop peu fiable (reflets, polices, hologrammes)
 * et refusait des pièces valables. Le document est toujours lu, et le texte
 * extrait est transmis, mais <b>plus aucun refus n'en découle</b>.</p>
 *
 * <p><b>L'autorité est le back-office</b> : il voit l'image ET ce qui en a été
 * lu, et c'est lui qui valide ou rejette la pièce.</p>
 */
@Injectable({ providedIn: 'root' })
export class IdDocumentService {
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  async analyser(imageDataUrl: string): Promise<AnalysePiece> {
    const vide: AnalysePiece = {
      ok: false, type: null, motifs: [], champsDetectes: [],
      largeur: 0, hauteur: 0, nettete: 0, texte: '',
    };
    if (!this.isBrowser) return vide;

    const img = await this.chargerImage(imageDataUrl);
    const motifs: string[] = [];

    // 1) Qualité — résolution puis netteté.
    const largeur = img.naturalWidth;
    const hauteur = img.naturalHeight;
    if (largeur < LARGEUR_MIN || hauteur < HAUTEUR_MIN) {
      motifs.push(`Image trop petite (${largeur}×${hauteur}) : ${LARGEUR_MIN}×${HAUTEUR_MIN} minimum.`);
    }
    const nettete = this.nettete(img);
    if (nettete < NETTETE_MIN) {
      motifs.push('Image floue : les informations ne sont pas lisibles. Reprenez la photo, bien à plat et nette.');
    }

    // 2) OCR — INFORMATIF uniquement.
    //
    // La reconnaissance automatique du type de pièce a été RETIRÉE : l'OCR d'une
    // photo de CNI est trop peu fiable (reflets, polices, hologrammes), et il
    // refusait des pièces parfaitement valables. On lit toujours le document et
    // on transmet le texte au back-office, mais plus aucun refus n'en découle :
    // c'est l'agent qui juge, en voyant l'image ET ce qui en a été lu.
    const texte = await this.ocr(imageDataUrl);
    const texteUtile = texte.replace(/\s+/g, ' ').trim();

    const type = this.detecterType(texte);            // peut rester null
    const champsDetectes = CHAMPS.filter(c => c.motif.test(texte)).map(c => c.cle);

    return {
      // Seule la QUALITÉ de l'image conditionne encore l'acceptation.
      ok: motifs.length === 0,
      type,
      motifs,
      champsDetectes,
      largeur,
      hauteur,
      nettete: Math.round(nettete),
      texte: texteUtile.slice(0, 2000),
    };
  }

  private detecterType(texte: string): TypePiece | null {
    for (const [type, motifs] of Object.entries(MARQUEURS) as [TypePiece, RegExp[]][]) {
      if (motifs.some(m => m.test(texte))) return type;
    }
    return null;
  }

  // ── OCR embarqué (assets auto-hébergés : CSP connect-src 'self') ───────────

  private async ocr(imageDataUrl: string): Promise<string> {
    try {
      const mod: any = await import('tesseract.js');
      // tesseract.js est un module CommonJS : selon l'interop du bundler, l'export
      // nomme se retrouve parfois sous `.default` plutot qu'a la racine — sans ce
      // repli, `createWorker` vaut `undefined` et l'appel echoue avec un message
      // opaque ("e is not a function").
      const createWorker = mod.createWorker ?? mod.default?.createWorker;
      if (typeof createWorker !== 'function') {
        console.error('[IdDocument] OCR indisponible : export createWorker introuvable', mod);
        return '';
      }
      const worker = await createWorker('fra', 1, {
        workerPath: '/tesseract/worker.min.js',
        corePath: '/tesseract',
        langPath: '/tesseract/lang',
      });
      try {
        const { data } = await worker.recognize(imageDataUrl);
        return data.text ?? '';
      } finally {
        await worker.terminate();
      }
    } catch (e) {
      console.error('[IdDocument] OCR indisponible', e);
      return '';
    }
  }

  // ── Netteté : variance du laplacien sur l'image en niveaux de gris ────────

  private nettete(img: HTMLImageElement): number {
    const L = 320; // analyse sur une version réduite : suffisant et rapide
    const h = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * L));
    const canvas = document.createElement('canvas');
    canvas.width = L;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return 0;
    ctx.drawImage(img, 0, 0, L, h);
    const { data } = ctx.getImageData(0, 0, L, h);

    // Niveaux de gris.
    const gris = new Float64Array(L * h);
    for (let i = 0; i < gris.length; i++) {
      const p = i * 4;
      gris[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
    }

    // Laplacien 3×3 puis variance : une image floue a peu de contours -> variance faible.
    const lap: number[] = [];
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < L - 1; x++) {
        const i = y * L + x;
        lap.push(
          -4 * gris[i] + gris[i - 1] + gris[i + 1] + gris[i - L] + gris[i + L],
        );
      }
    }
    if (!lap.length) return 0;
    const moyenne = lap.reduce((s, v) => s + v, 0) / lap.length;
    return lap.reduce((s, v) => s + (v - moyenne) ** 2, 0) / lap.length;
  }

  private chargerImage(dataUrl: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('image illisible'));
      img.src = dataUrl;
    });
  }
}
