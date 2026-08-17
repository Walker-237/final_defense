import { AFRILAND_LOGO_DATA_URI } from './afriland-logo';

/** Correspondance type MIME → extension de fichier (pour nommer les téléchargements). */
const MIME_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'text/csv': 'csv',
  'text/plain': 'txt',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xls',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

/** Construit un nom de fichier sûr, avec l'extension dérivée du type MIME. */
export function documentFileName(titre: string, reference: string, mimeType?: string): string {
  const base = (titre || reference || 'document').replace(/[\\/:*?"<>|]+/g, '_').trim();
  const ext = mimeType ? (MIME_EXT[mimeType.split(';')[0].trim()] ?? '') : '';
  return ext && !base.toLowerCase().endsWith('.' + ext) ? `${base}.${ext}` : base;
}

/**
 * Convertit un data-URI (ou du base64 nu) en Blob, SANS `fetch`.
 *
 * On évite volontairement `fetch('data:…')` : la CSP `connect-src 'self'` de la
 * plateforme bloque les requêtes vers un schéma `data:`. Le décodage manuel via
 * `atob` produit le Blob directement, sans requête réseau.
 */
export function dataUriToBlob(
  contenu: string,
  fallbackMime = 'application/octet-stream',
  forceMime?: string,
): Blob {
  let mime = fallbackMime;
  let data = contenu;
  let isBase64 = true;
  const comma = contenu.indexOf(',');
  if (contenu.startsWith('data:') && comma !== -1) {
    const meta = contenu.slice(5, comma); // ex. "application/pdf;base64"
    isBase64 = /;base64/i.test(meta);
    const m = meta.split(';')[0].trim();
    if (m) mime = m;
    data = contenu.slice(comma + 1);
  }
  // forceMime prime sur le type embarqué : permet d'imposer un type sûr et
  // d'ignorer un type potentiellement piégé (text/html, svg…) présent dans l'URI.
  if (forceMime) mime = forceMime;
  const binary = isBase64 ? atob(data) : decodeURIComponent(data);
  const bytes = new Uint8Array(binary.length);
  // Chaque caractère de `binary` tient sur un octet (U+0000–U+00FF) : aucune
  // paire de substitution, donc codePointAt et charCodeAt coïncident ici.
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.codePointAt(i) ?? 0;
  return new Blob([bytes], { type: mime });
}

/**
 * Types MIME que l'on accepte d'ouvrir INLINE dans un nouvel onglet.
 *
 * On exclut volontairement text/html, image/svg+xml, application/xhtml+xml et
 * tout type scriptable : un blob: hérite de l'origine de l'application, donc un
 * tel contenu (téléversé par un tiers) s'exécuterait dans le contexte bancaire
 * (XSS stockée inter-utilisateurs). Tout autre type est forcé en téléchargement.
 */
const VIEW_INLINE_OK = new Set([
  'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/plain',
]);

/**
 * Ouvre (consultation) ou télécharge un document encodé en data-URI base64.
 * Centralise le flux utilisé côté client et côté back-office.
 */
export async function openDocumentDataUri(
  contenu: string,
  titre: string,
  reference: string,
  mimeType: string | undefined,
  mode: 'view' | 'download',
): Promise<void> {
  if (typeof window === 'undefined' || !contenu) return;
  const baseMime = (mimeType || 'application/octet-stream').split(';')[0].trim().toLowerCase();
  const canInline = VIEW_INLINE_OK.has(baseMime);
  // Le Blob est reconstruit avec un type SÛR (jamais celui, potentiellement
  // piégé, fourni à l'upload) : un type non whitelisté devient octet-stream et
  // est forcé en téléchargement, ce qui empêche toute exécution dans l'origine.
  const safeMime = canInline ? baseMime : 'application/octet-stream';
  const blob = dataUriToBlob(contenu, safeMime, safeMime);
  const url = URL.createObjectURL(blob);
  if (mode === 'view' && canInline) {
    window.open(url, '_blank', 'noopener,noreferrer');
  } else {
    const a = document.createElement('a');
    a.href = url;
    a.download = documentFileName(titre, reference, mimeType);
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Trigger a browser download for the given text content */
export function downloadBlob(filename: string, content: string, mime = 'text/plain;charset=utf-8') {
  if (typeof document === 'undefined') return;
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function arrayToCsv(rows: Array<Record<string, any>>, headers?: string[]): string {
  if (!rows.length) return '';
  const cols = headers ?? Object.keys(rows[0]);
  const esc = (v: any) => {
    const s = v == null ? '' : String(v);
    return /[",\n;]/.test(s) ? `"${s.replaceAll('"','""')}"` : s;
  };
  return [cols.join(';'), ...rows.map(r => cols.map(c => esc(r[c])).join(';'))].join('\n');
}

/** Échappe les caractères HTML pour empêcher toute injection XSS lors du rendu. */
function escapeHtml(value: any): string {
  if (value === null || value === undefined) return '';
  // L'esperluette est traitée en premier : sinon les entités produites ensuite
  // seraient réencodées (« &lt; » → « &amp;lt; »).
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('`', '&#96;')
    .replaceAll('=', '&#61;');
}

/** N'autorise que les data URI image attendues pour la signature (anti XSS via src). */
function safeImageDataUri(uri: any): string {
  if (typeof uri !== 'string') return '';
  // Whitelist stricte : data:image/(png|jpeg|webp|svg+xml);base64,<base64>
  if (!/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(uri)) return '';
  if (uri.length > 2_000_000) return '';
  return uri;
}

// ════════════════════ MISE EN PAGE DES DOCUMENTS OFFICIELS ════════════════════
//
// Documents officiels (ordre client, avis d'opéré) rendus en NOIR SUR BLANC, sans
// en-tête/logo bancaire ni couleur (impression sur papier à en-tête pré-imprimé).

const BANK_DOC_CSS = `
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; }
    body { font-family:'Times New Roman', Times, serif; color:#1a1a1a; margin:0;
           font-size:13px; line-height:1.5; }
    .sheet { min-height:1000px; display:flex; flex-direction:column; }
    .doc-body { flex:1 0 auto; }
    .doc-title { text-align:center; font-size:15px; font-weight:bold; letter-spacing:.5px;
                 text-transform:uppercase; margin:18px 0 4px; }
    .doc-title-underline { width:120px; height:2px; background:#000; margin:0 auto 8px; }`;

/** Build the HTML representation of the client order form (Times New Roman style)
 *  used to generate a PDF that mirrors exactly what the client filled out.
 *  Toutes les valeurs issues de l'utilisateur sont systématiquement échappées (anti XSS). */
/**
 * Formule d'adresse portée sur les documents générés : le contenu du champ
 * « dirigeant » du client, ou à défaut « Monsieur » (personne physique) /
 * « Directeur » (personne morale). Valeur brute (non échappée) — les gabarits
 * l'échappent avant insertion.
 */
export function formuleDirigeant(o: import('../core/models/models').Order): string {
  const d = (o.dirigeant ?? '').trim();
  if (d) return d;
  return o.typePersonne === 'PM' ? 'Directeur' : 'Monsieur';
}

export function buildClientOrderFormHtml(o: import('../core/models/models').Order): string {
  const snap = o.formSnapshot;
  const fmt = (n: number) => (Number(n) || 0).toLocaleString('fr-FR');

  const date          = escapeHtml(snap?.date ?? (o.dateSoumission || '').slice(0, 10));
  const intitule      = escapeHtml(snap?.intitule ?? o.clientNom);
  const telephone     = escapeHtml(snap?.telephone ?? '');
  const contactNom    = escapeHtml(snap?.contactNom ?? o.clientNom);
  const contactTel    = escapeHtml(snap?.contactTel ?? '');
  const contactMail   = escapeHtml(snap?.contactMail ?? '');
  const compte        = escapeHtml(snap?.compte ?? o.compteEspeces);
  const compteTitres  = escapeHtml(o.compteTitres ?? '');
  const reference     = escapeHtml(o.reference);
  const emissionCode  = escapeHtml(o.emissionCode);
  const isin          = escapeHtml(o.isin ?? '');
  const nature        = escapeHtml(o.nature);
  const emetteur      = escapeHtml(o.emetteur);
  const canal         = o.canal === 'GUICHET' ? 'Guichet' : o.canal === 'EMAIL' ? 'E-mail' : 'En ligne';
  // Formule d'adresse = « dirigeant » du client (défaut PP=Monsieur, PM=Directeur).
  const dirigeant     = escapeHtml(formuleDirigeant(o));

  const lignes = snap?.lignes?.length
    ? snap.lignes
    : [{ volume: o.volume, taux: o.tauxSoumis, montant: o.montant, montantLettres: '' }];

  const totalMontant  = snap?.totalMontant ?? lignes.reduce((s, l) => s + (Number(l.montant) || 0), 0);
  const totalLettres  = escapeHtml(snap?.totalLettres ?? '');
  const signatureData = safeImageDataUri(snap?.signatureData ?? o.signatureData ?? '');

  const td = (content: string, style = '') =>
    `<td style="border:1px solid #000;padding:7px 8px;${style}">${content}</td>`;

  const ligneRows = lignes.map(l => `
    <tr>
      ${td(escapeHtml(String(l.volume)), 'text-align:center')}
      ${td(escapeHtml(fmt(l.montant)), 'text-align:right;font-family:monospace')}
      ${td(escapeHtml(l.montantLettres || ''), 'font-style:italic;font-size:11px')}
      ${td(escapeHtml(String(l.taux)) + ' %', 'text-align:right')}
    </tr>`).join('');

  const totalRow = `
    <tr style="font-weight:bold;background:#f5f5f5">
      ${td('TOTAL', 'text-align:center')}
      ${td(fmt(totalMontant), 'text-align:right;font-family:monospace')}
      ${td(totalLettres, 'font-style:italic;font-size:11px')}
      ${td('', '')}
    </tr>`;

  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<title>Ordre ${reference}</title>
<style>
  ${BANK_DOC_CSS}
  .meta-top { display:flex; justify-content:space-between; align-items:flex-start; margin-top:16px; font-size:13px; }
  .meta-top .ref { font-weight:bold; }
  .val { display:inline; font-weight:600; }
  .val.mono { font-family:'Courier New', Courier, monospace; }
  p { margin:14px 0; line-height:1.6; text-align:justify; }
  table.ordre { width:100%; border-collapse:collapse; margin:18px 0; font-size:12.5px; }
  table.ordre th { background:#f0f0f0; border:1px solid #000; padding:7px 8px; color:#000; font-weight:bold; }
  table.ordre td { border:1px solid #000; padding:7px 8px; line-height:1.4; }
  .lst { margin:8px 0 0 16px; padding:0; font-size:13px; line-height:1.9; list-style:none; }
  .lst li { margin:4px 0; }
  .lst li .lbl { display:inline-block; min-width:210px; font-weight:600; }
  .sig-box { margin-top:40px; text-align:center; }
  .sig-img { max-height:90px; display:block; margin:0 auto; }
  .info-grid { display:grid; grid-template-columns:1fr 1fr; gap:6px 24px; margin-top:14px; font-size:13px; line-height:1.9; }
  .info-grid .lbl { font-weight:600; }
</style></head><body style="padding:16mm 18mm">
  <div class="sheet">
    <div class="doc-body">

      <div class="meta-top">
        <div class="ref">N° d'ordre : <span class="val mono">${reference}</span></div>
        <div>Yaoundé, le <span class="val">${date}</span></div>
      </div>

      <div class="doc-title">Ordre d'achat de valeurs du Trésor</div>
      <div class="doc-title-underline"></div>

      <div style="margin-top:16px;font-size:13px">
        <b>Objet :</b> Achat de Valeurs du Trésor &nbsp;|&nbsp; <b>Canal :</b> ${canal}
      </div>

      <p>Nous vous remettons ci-après, notre ordre pour l'achat des valeurs du Trésor détaillées ci-dessous :</p>

      <ul class="lst">
        <li><span class="lbl">Code émission :</span> <span class="val mono">${emissionCode}</span></li>
        <li><span class="lbl">Code ISIN :</span> <span class="val mono">${isin}</span></li>
        <li><span class="lbl">Nature :</span> <span class="val">${nature}</span></li>
        <li><span class="lbl">Émetteur :</span> <span class="val">${emetteur}</span></li>
      </ul>

      <table class="ordre">
        <thead><tr>
          <th>Volume demandé</th>
          <th>Montant demandé (FCFA)</th>
          <th>Montant en lettres</th>
          <th>Prix / Taux</th>
        </tr></thead>
        <tbody>${ligneRows}${totalRow}</tbody>
      </table>

      <p>Pour la réalisation dudit ordre, nous vous autorisons à débiter notre compte dans vos livres :</p>

      <ul class="lst">
        <li><span class="lbl">Compte espèces à débiter :</span> <span class="val mono">${compte}</span></li>
        <li><span class="lbl">Compte titres à créditer :</span> <span class="val mono">${compteTitres}</span></li>
        <li><span class="lbl">Intitulé du compte :</span> <span class="val">${intitule}</span></li>
        <li><span class="lbl">Téléphone :</span> <span class="val">${telephone}</span></li>
      </ul>

      <div class="info-grid" style="margin-top:18px">
        <div><span class="lbl">Personne à contacter :</span> ${contactNom}</div>
        <div><span class="lbl">Téléphone :</span> ${contactTel}</div>
        <div><span class="lbl">Adresse e-mail :</span> ${contactMail}</div>
        <div><span class="lbl">Date de soumission :</span> ${date}</div>
      </div>

      <p style="margin-top:28px">Veuillez agréer, ${dirigeant}, l'assurance de notre considération distinguée.</p>

      <div class="sig-box">
        <div style="font-weight:bold;font-size:13px;margin-bottom:8px">Signature(s) autorisée(s)</div>
        ${signatureData
          ? `<img class="sig-img" src="${signatureData}" alt="signature"/>`
          : `<div style="height:80px;max-width:280px;margin:0 auto"></div>`}
      </div>

    </div>
  </div>
</body></html>`;
}

/** Facteur d'échelle html2canvas (≈ dpi/96). 1.5 ≈ 144 dpi : net pour un A4
 *  texte tout en réduisant fortement le temps de rendu vs 2 (≈192 dpi). */
const PDF_RENDER_SCALE = 1.5;

/** Callback de progression de la génération PDF (pourcentage + libellé d'étape). */
export type PdfProgress = (percent: number, label?: string) => void;

/**
 * Rendu HTML → PDF A4 (jsPDF + html2canvas), partagé par l'ordre et l'avis d'opéré.
 *
 * Le HTML est parsé via DOMParser puis ré-injecté nœud par nœud (jamais d'innerHTML
 * brut) après suppression défensive de tout gestionnaire d'évènement inline et des
 * URI dangereuses. Le wrapper hors écran fait 794px (≈ largeur A4 à 96dpi) : l'image
 * occupe toute la largeur de page, donc les marges/décalages se règlent en padding
 * dans le HTML lui-même (le rendu html2canvas ignore les marges @page).
 *
 * Important : html2canvas ne capture que les enfants du <body>. On recopie donc
 * explicitement les <style> du <head> ET le style inline du <body> (marges/padding)
 * sur le wrapper, sinon les règles de classe et les marges seraient perdues au PDF.
 * Le wrapper est en box-sizing:border-box pour que le padding reste DANS les 794px.
 */
async function renderSanitizedHtmlToPdfDoc(html: string, onProgress?: PdfProgress): Promise<any | null> {
  if (typeof document === 'undefined') return null;
  onProgress?.(10, 'Chargement du moteur PDF…');
  const [{ default: jsPDF }, html2canvasMod] = await Promise.all([
    import('jspdf'),
    import('html2canvas')
  ]);
  const html2canvas = (html2canvasMod as any).default ?? html2canvasMod;
  onProgress?.(25, 'Préparation du document…');

  const parsed = new DOMParser().parseFromString(html, 'text/html');
  parsed.querySelectorAll('*').forEach(el => {
    Array.from(el.attributes).forEach(attr => {
      const name = attr.name.toLowerCase();
      const val = attr.value || '';
      if (name.startsWith('on')) el.removeAttribute(attr.name);
      if ((name === 'href' || name === 'src') && /^(javascript|vbscript|data:text\/html)/i.test(val.trim())) {
        el.removeAttribute(attr.name);
      }
    });
  });

  const wrapper = document.createElement('div');
  wrapper.style.position = 'fixed';
  wrapper.style.left = '-10000px';
  wrapper.style.top = '0';
  wrapper.style.width = '794px';
  wrapper.style.boxSizing = 'border-box';
  wrapper.style.background = '#fff';
  // Reporte le padding/marges declarees en inline sur le <body> (le <body>
  // d'origine n'est pas conserve par html2canvas).
  const bodyStyle = parsed.body.getAttribute('style');
  if (bodyStyle) wrapper.style.cssText += ';' + bodyStyle;
  // Recopie les <style> du <head> pour que les regles de classe s'appliquent.
  parsed.head.querySelectorAll('style').forEach(s => wrapper.appendChild(s.cloneNode(true)));
  Array.from(parsed.body.childNodes).forEach(n => wrapper.appendChild(n.cloneNode(true)));
  document.body.appendChild(wrapper);

  try {
    // Attend le decodage des images (logo, signature) avant la capture, pour
    // garantir qu'elles figurent bien dans le PDF.
    await Promise.all(Array.from(wrapper.querySelectorAll('img')).map(img => {
      const el = img as HTMLImageElement;
      if (el.complete) return Promise.resolve();
      return el.decode().catch(() => undefined);
    }));
    onProgress?.(40, 'Rendu en cours…');
    // Le temps de génération est ~proportionnel au nombre de pixels rastérisés.
    // scale 1.5 (≈144 dpi) suffit pour un A4 texte/noir-sur-blanc et divise le
    // travail par ~1,8 vs scale 2, tout en restant net à l'impression.
    // logging désactivé et imageTimeout=0 évitent les attentes inutiles.
    const canvas = await html2canvas(wrapper, {
      scale: PDF_RENDER_SCALE, backgroundColor: '#ffffff', useCORS: true,
      logging: false, imageTimeout: 0, removeContainer: true,
    });
    onProgress?.(75, 'Encodage…');
    // JPEG 0.92 : encodage nettement plus rapide et PDF bien plus léger que PNG
    // (téléchargement/upload plus rapides) ; rendu d'un document texte préservé.
    const imgData = canvas.toDataURL('image/jpeg', 0.92);
    const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    let heightLeft = imgHeight;
    let position = 0;
    pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }
    onProgress?.(95, 'Finalisation…');
    return pdf;
  } finally {
    wrapper.remove();
  }
}

/** Rend le HTML en PDF puis le télécharge. */
async function renderSanitizedHtmlToPdf(html: string, fileName: string, onProgress?: PdfProgress): Promise<void> {
  const pdf = await renderSanitizedHtmlToPdfDoc(html, onProgress);
  if (pdf) pdf.save(fileName);
}

/** Rend le HTML en PDF et renvoie le data URI base64 (`data:application/pdf;base64,…`)
 *  — utilisé pour transmettre le document au backend (menu Documents du client). */
export async function renderSanitizedHtmlToPdfDataUri(html: string, onProgress?: PdfProgress): Promise<string> {
  const pdf = await renderSanitizedHtmlToPdfDoc(html, onProgress);
  return pdf ? (pdf.output('datauristring') as string) : '';
}

/** Generate and download a PDF of the client order using jsPDF + html2canvas.
 *  Toutes les valeurs sont déjà échappées via escapeHtml dans buildClientOrderFormHtml. */
export async function downloadClientOrderPdf(o: import('../core/models/models').Order, onProgress?: PdfProgress): Promise<void> {
  await renderSanitizedHtmlToPdf(buildClientOrderFormHtml(o), `${o.reference}.pdf`, onProgress);
}

// ════════════════════════ AVIS D'OPÉRÉ (SVT → client) ════════════════════════
//
// Document émis après adjudication, imprimé sur PAPIER À EN-TÊTE Afriland :
// la mise en page réserve un bandeau haut (logo pré-imprimé) et décale le
// contenu vers la droite pour dégager la marge gauche de l'en-tête.
//
// CALCUL AUTOMATIQUE — règles métier :
//   date de valeur  = date limite de souscription + 2 jours calendaires
//   BTA  : intérêt précompté = Montant × taux/100 × jours/360
//           coupon couru     = Montant × taux/100 × (dateValeur − dernière anniversaire)/360
//           montant net BTA  = Montant adjugé − intérêt précompté + coupon couru
//   OTA  : intérêt annuel   = Montant × taux/100
//           coupon couru     = Montant × taux/100 × (dateValeur − dernière anniversaire)/365
//           décote           = max(0, montant nominal − montant adjugé)
//           montant net OTA  = Montant adjugé − décote + coupon couru
//   commission      = Montant adjugé × 0,10 %   (valeur exacte, sans arrondi)
//   FVA (TVA)       = commission × 19,25 %       (valeur exacte, sans arrondi)
//   NET À DÉBITER   = montant net + commission + FVA
const TAUX_COMMISSION_COURTAGE = 0.0010;
const TAUX_FVA = 0.1925;
const BASE_COUPON_JOURS_OTA = 365;
const BASE_COUPON_JOURS_BTA = 360;

export interface AvisOpereCalcul {
  quantiteDemandee: number;
  montantDemande: number;
  prix: number;
  montantAdjuge: number;
  interets: number;
  joursInterets: number;
  dateValeur: Date | null;
  montantNet: number;
  commissionCourtage: number;
  fva: number;
  netADebite: number;
  couponCouru: number;
  decote: number;
}

/** Parse une date 'AAAA-MM-JJ', 'JJ/MM/AAAA' ou ISO en Date locale (ou null). */
function parseAvisDate(s?: string): Date | null {
  if (!s) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]);
  const fr = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  if (fr) return new Date(+fr[3], +fr[2] - 1, +fr[1]);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Ajoute `months` mois en recalant sur le dernier jour si le mois cible est plus court. */
function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() < day) d.setDate(0);
  return d;
}

/** Ajoute `days` jours calendaires à une date locale. */
function addDays(date: Date, days: number): Date {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

/** Dernière date anniversaire de `dateEmission` qui est ≤ `dateRef` (pour calcul coupon couru OTA). */
function derniereAnniversaire(dateEmission: Date | null, dateRef: Date | null): Date | null {
  if (!dateEmission || !dateRef) return null;
  const ann = new Date(dateEmission);
  ann.setFullYear(dateRef.getFullYear());
  if (ann > dateRef) ann.setFullYear(ann.getFullYear() - 1);
  return ann;
}

const AVIS_MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const AVIS_JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const frLongDate = (d: Date) => `${AVIS_JOURS[d.getDay()]} ${d.getDate()} ${AVIS_MOIS[d.getMonth()]} ${d.getFullYear()}`;
const frShortDate = (d: Date | null) => {
  if (!d) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};

/**
 * Calcule l'intégralité des montants de l'avis d'opéré à partir de l'ordre
 * (post-adjudication) et de sa fiche émission. Pour un BTA (zéro coupon) ou en
 * l'absence de fiche émission, le coupon couru vaut 0.
 */
export function computeAvisOpere(
  o: import('../core/models/models').Order,
  em?: import('../core/models/models').Emission,
): AvisOpereCalcul {
  const vn = em?.valeurNominaleUnitaire || (o.volume ? o.montant / o.volume : 0);
  const quantiteDemandee = o.volume;
  const montantDemande = o.montant;
  const volAdjuge = o.volumeAlloue ?? o.volume;
  const montantAdjuge = o.montantAdjuge ?? (volAdjuge * vn);
  const prix = o.tauxAdjuge ?? o.tauxSoumis ?? 100;

  // Date de valeur = date limite de souscription + 2 jours calendaires
  const souscriptionLimit = parseAvisDate(em?.fermetureSouscription);
  const valueDate = souscriptionLimit ? addDays(souscriptionLimit, 2) : parseAvisDate(em?.dateReglement);
  const maturity = parseAvisDate(em?.dateEcheance);
  const emissionDate = parseAvisDate(em?.dateEmission);
  const tauxInteret = o.tauxAdjuge ?? em?.tauxNominal ?? o.tauxSoumis ?? 0;

  // Nombre de jours entre date de valeur et date d'échéance
  const joursInterets = valueDate && maturity
    ? Math.max(0, Math.round((maturity.getTime() - valueDate.getTime()) / 86_400_000))
    : 0;

  let interets: number;
  let couponCouru: number;
  let decote: number;
  let montantNet: number;

  // Le coupon couru ne s'applique qu'aux abondements (réouverture d'une émission
  // existante) — une NOUVELLE EMISSION ne génère pas de coupon couru.
  const isAbondement = em?.observation?.toUpperCase() === 'ABONDEMENT';

  if (o.nature === 'BTA') {
    // BTA (zéro coupon, intérêts précomptés) — base ACT/360
    // Intérêt précompté = Montant adjugé × taux/100 × Nb jours (valeur → échéance) / 360
    interets = montantAdjuge * (tauxInteret / 100) * joursInterets / BASE_COUPON_JOURS_BTA;

    // Coupon couru BTA (abondement uniquement) — base ACT/360
    // = Montant adjugé × taux/100 × (dateValeur − dernière date anniversaire) / 360
    if (isAbondement) {
      const dernierAnn = derniereAnniversaire(emissionDate, valueDate);
      const joursCoupon = valueDate && dernierAnn
        ? Math.max(0, Math.round((valueDate.getTime() - dernierAnn.getTime()) / 86_400_000))
        : 0;
      couponCouru = montantAdjuge * (tauxInteret / 100) * joursCoupon / BASE_COUPON_JOURS_BTA;
    } else {
      couponCouru = 0;
    }
    decote = 0;

    // Montant net BTA = Montant adjugé − intérêt précompté + coupon couru
    montantNet = montantAdjuge - interets + couponCouru;
  } else {
    // OTA (obligations à taux fixe) — base ACT/365
    // Intérêt annuel = Montant adjugé × taux/100
    interets = montantAdjuge * (tauxInteret / 100);

    // Coupon couru OTA (abondement uniquement) — base ACT/365
    // = Montant adjugé × taux/100 × (dateValeur − dernière date anniversaire) / 365
    if (isAbondement) {
      const dernierAnn = derniereAnniversaire(emissionDate, valueDate);
      const joursCoupon = valueDate && dernierAnn
        ? Math.max(0, Math.round((valueDate.getTime() - dernierAnn.getTime()) / 86_400_000))
        : 0;
      couponCouru = montantAdjuge * (tauxInteret / 100) * joursCoupon / BASE_COUPON_JOURS_OTA;
    } else {
      couponCouru = 0;
    }

    // Décote = (100% − prix d'acquisition) × (Volume alloué × Valeur nominale unitaire)
    decote = Math.max(0, (1 - prix / 100) * (volAdjuge * vn));

    // Montant net OTA = Montant adjugé − décote + coupon couru
    montantNet = montantAdjuge - decote + couponCouru;
  }

  // Commission et TVA sans arrondi
  const commissionCourtage = montantAdjuge * TAUX_COMMISSION_COURTAGE;
  const fva = commissionCourtage * TAUX_FVA;
  const netADebite = montantNet + commissionCourtage + fva;

  return {
    quantiteDemandee, montantDemande, prix, montantAdjuge,
    interets, joursInterets, dateValeur: valueDate, montantNet,
    commissionCourtage, fva, netADebite, couponCouru, decote,
  };
}

/**
 * Signature d'un dirigeant habilité, apposée sur les documents de la banque.
 * Alimentée par l'espace d'administration (Signatures dirigeants).
 */
export interface SignataireBanque {
  nom: string;
  fonction: string;
  /** Image de la signature (data URI). */
  signatureData: string;
}

/**
 * Rend le bloc des signatures de la banque.
 *
 * <p>Chaque image passe par {@link safeImageDataUri} et chaque libellé par
 * {@link escapeHtml} : le document est du HTML rendu puis capturé en PDF, une
 * valeur non filtrée y serait une injection.</p>
 */
function renderSignatairesBanque(signataires?: SignataireBanque[]): string {
  const valides = (signataires ?? [])
    .map((s) => ({ ...s, img: safeImageDataUri(s.signatureData) }))
    .filter((s) => s.img);
  if (!valides.length) return '';

  const blocs = valides.map((s) => `
        <div style="display:inline-block;text-align:center;margin-left:24px;vertical-align:top">
          <img src="${s.img}" alt="Signature" style="max-height:70px;display:block;margin:0 auto"/>
          <div style="font-weight:bold;font-size:10pt;margin-top:2px">${escapeHtml(s.nom)}</div>
          <div style="font-size:9pt">${escapeHtml(s.fonction)}</div>
        </div>`).join('');

  return `<div style="margin-top:6px">${blocs}</div>`;
}

export interface AvisOpereOptions {
  /** Numéro de l'avis (partie variable de « N° … First Bank/DFGB/AA »). */
  numero?: string;
  /**
   * Signatures des dirigeants habilités, apposées en bas du document.
   * Chargées depuis l'espace d'administration ; absentes, le document est
   * généré sans signature de la banque.
   */
  signataires?: SignataireBanque[];
  /** Ville du destinataire (défaut : Yaoundé). */
  ville?: string;
  /** Date d'émission de l'avis (défaut : aujourd'hui). */
  date?: Date;
  /**
   * Type de client pour la civilité :
   *   'PP_M' → Monsieur (personne physique masculin)
   *   'PP_F' → Madame   (personne physique féminin)
   *   'PM'   → Monsieur le Directeur Général (personne morale / entreprise)
   * Défaut : 'PM'
   */
  clientType?: 'PP_M' | 'PP_F' | 'PM';
  /**
   * Formule d'adresse explicite (le « dirigeant » du client). Si absente, elle
   * est déduite de l'ordre : champ `dirigeant`, ou défaut « Monsieur » (PP) /
   * « Directeur » (PM). Remplace la civilité sur le document.
   */
  dirigeant?: string;
}

/**
 * Construit le HTML de l'avis d'opéré fidèle au modèle Afriland First Bank.
 *
 * Mise en page identique au document officiel :
 *   • Logo centré en haut sur toute la largeur
 *   • Colonne grise à gauche (~4 cm) réservée au papier pré-imprimé — VIDE dans le HTML
 *   • Contenu à droite de la colonne grise avec marges symétriques
 *   • Civilité adaptée : M. / Mme (PP) ou Monsieur le Directeur Général (PM)
 */
export function buildAvisOpereHtml(
  o: import('../core/models/models').Order,
  em?: import('../core/models/models').Emission,
  opts: AvisOpereOptions = {},
): string {
  const c = computeAvisOpere(o, em);
  const isBTA = o.nature === 'BTA';

  const fmt = (n: number) => {
    const v = Number(n) || 0;
    const s = Math.abs(v).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 10 });
    return v < 0 ? `-${s}` : s;
  };
  const pct = (n: number) =>
    `${(Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 10 })}%`;

  const today   = opts.date ?? new Date();
  const annee2  = String(today.getFullYear()).slice(-2);
  const numero  = escapeHtml(opts.numero ?? (o.reference.match(/(\d+)\s*$/)?.[1] ?? o.reference));
  const villeUC = escapeHtml((opts.ville ?? 'YAOUNDÉ').toUpperCase());
  const villeLC = villeUC.charAt(0) + villeUC.slice(1).toLowerCase();
  const client  = escapeHtml(o.clientNom.toUpperCase());
  const emetteur = escapeHtml((o.emetteur || '').toUpperCase());
  const nature   = escapeHtml(o.nature);
  const libelle  = escapeHtml(em?.libelle ?? o.nature);
  const valeur   = escapeHtml(`${o.isin} ${em?.libelle ?? o.nature}`);
  const dateValeur    = escapeHtml(frShortDate(c.dateValeur));
  const volAdjuge     = o.volumeAlloue ?? o.volume;
  const compteEspeces = escapeHtml(o.compteEspeces);
  const col5Header    = isBTA ? 'INTÉRÊTS<br>PRÉCOMPTÉS' : 'DÉCOTE';
  const col5Value     = isBTA ? c.interets : c.decote;

  // ── Formule d'adresse = « dirigeant » du client (remplace la civilité) ────
  // Défaut PP = « Monsieur », PM = « Directeur ». Repli sur opts.clientType
  // lorsque le type n'est pas porté par l'ordre (compatibilité ascendante).
  const estPP = o.typePersonne === 'PP'
             || (o.typePersonne == null && (opts.clientType === 'PP_M' || opts.clientType === 'PP_F'));
  const dirigeant = escapeHtml(
    (opts.dirigeant ?? o.dirigeant ?? '').trim() || (estPP ? 'Monsieur' : 'Directeur'));
  const titreEntete = `${dirigeant},`;
  const salutation  = `${dirigeant} ,`;
  const formule     = dirigeant;

  return `<!doctype html><html lang="fr"><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<title>Avis d'opéré ${escapeHtml(o.reference)}</title>
<style>
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Times New Roman', Times, serif;
    font-size: 11pt;
    color: #000;
    background: #fff;
  }

  /* ── Logo pleine largeur (barre du haut) ── */
  .ao-logo {
    text-align: center;
    padding: 14px 0 10px;
    border-bottom: 1px solid #c0c0c0;
  }
  .ao-logo img { height: 62px; width: auto; }

  /* ── Disposition deux colonnes ── */
  .ao-wrap {
    display: flex;
    min-height: 960px;
  }

  /* ── Colonne grise gauche (~4 cm) — VIDE, réservée au papier pré-imprimé ── */
  .ao-side {
    width: 155px;
    min-width: 155px;
    background: #ebebeb;
    flex-shrink: 0;
  }

  /* ── Zone de contenu principal ── */
  .ao-body {
    flex: 1;
    padding: 14px 24px 28px 16px;
    min-width: 0;
  }

  /* ── N° avis + ville/date ── */
  .ao-ref {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-size: 10.5pt;
    margin-bottom: 24px;
  }

  /* ── Bloc destinataire (calé à droite, 45 % de marge gauche dans la zone contenu) ── */
  .ao-dest {
    margin-left: 44%;
    line-height: 1.9;
    font-size: 11pt;
    margin-bottom: 22px;
  }

  /* ── OBJET ── */
  .ao-objet { font-size: 11pt; margin-bottom: 14px; }

  /* ── Corps de lettre ── */
  p { text-align: justify; margin-bottom: 9px; font-size: 11pt; line-height: 1.5; }

  /* ── Tableau EMETTEUR / VALEUR / NATURE / DATE ── */
  table.meta { border-collapse: collapse; margin-bottom: 12px; }
  table.meta td { padding: 2px 6px 2px 0; font-size: 11pt; vertical-align: top; }
  table.meta td.k { font-weight: bold; white-space: nowrap; min-width: 130px; }

  /* ── Tableau de calcul (7 colonnes) ── */
  table.calc {
    width: 100%; border-collapse: collapse;
    margin-bottom: 14px; font-size: 9pt;
  }
  table.calc th {
    border: 1px solid #000; padding: 4px 3px;
    text-align: center; font-weight: bold;
    font-size: 8pt; line-height: 1.2;
  }
  table.calc td {
    border: 1px solid #000; padding: 3px 5px;
    text-align: right; vertical-align: middle;
  }
  table.calc td.lbl { text-align: left; font-style: italic; }
  table.calc td.c   { text-align: center; }
  table.calc tr.net td { font-weight: bold; }

  /* ── Lignes Débit / Crédit ── */
  .ao-txts { font-size: 10.5pt; font-style: italic; line-height: 1.7; margin-bottom: 14px; }
  .ao-txts p { text-align: left; margin-bottom: 3px; }

  /* ── Signature ── */
  .ao-sig { margin-top: 30px; font-size: 11pt; text-align: right; }
  .ao-sig-title { font-weight: bold; text-decoration: underline; }

  /* ── Note de bas de page ── */
  .ao-note { margin-top: 12px; font-size: 7.5pt; font-style: italic; color: #444; }
</style>
</head><body>

  <!-- Logo centré sur toute la largeur de la page (colonne grise incluse) -->
  <div class="ao-logo">
    <img src="${AFRILAND_LOGO_DATA_URI}" alt="Afriland First Bank">
  </div>

  <!-- Disposition : colonne grise vide | contenu principal -->
  <div class="ao-wrap">

    <!-- Colonne grise gauche — VIDE (informations pré-imprimées sur le papier à en-tête) -->
    <div class="ao-side"></div>

    <!-- Contenu principal -->
    <div class="ao-body">

      <!-- N° avis (gauche) + Ville et date (droite) -->
      <div class="ao-ref">
        <div>N° <b>${numero}</b> First Bank/DFGB/${escapeHtml(annee2)}</div>
        <div>${escapeHtml(villeLC)}, le ${escapeHtml(frLongDate(today))}</div>
      </div>

      <!-- Bloc destinataire -->
      <div class="ao-dest">
        ${titreEntete}<br>
        <br>
        <b>${client}</b><br>
        <br>
        ${villeUC}
      </div>

      <!-- Objet -->
      <div class="ao-objet">OBJET :&nbsp;&nbsp;&nbsp;&nbsp;<u><b>AVIS D'OPÉRÉ</b></u></div>

      <p>${salutation}</p>

      <p>En exécution de l'ordre d'achat que vous avez bien voulu nous transmettre pour la
      négociation sur le marché des titres publics de la BEAC des valeurs du Trésor, nous avons
      le plaisir de vous annoncer que votre offre a été retenue comme détaillé ci-dessous :</p>

      <!-- Champs émission -->
      <table class="meta">
        <tr><td class="k">EMETTEUR :</td><td>${emetteur}</td></tr>
        <tr><td class="k">VALEUR :</td><td>${valeur}</td></tr>
        <tr><td class="k">NATURE :</td><td>${nature}</td></tr>
        <tr><td class="k">DATE DE VALEUR :</td><td><b>${dateValeur}</b></td></tr>
      </table>

      <!-- Tableau de calcul (7 colonnes) -->
      <table class="calc">
        <thead>
          <tr>
            <th>QUANTITÉ<br>DEMANDÉE</th>
            <th>MONTANT<br>DEMANDÉ</th>
            <th>PRIX</th>
            <th>MONTANT<br>ADJUGÉ</th>
            <th>${col5Header}</th>
            <th>COUPON<br>COURU</th>
            <th>MONTANT NET</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="c">${fmt(c.quantiteDemandee)}</td>
            <td>${fmt(c.montantDemande)}</td>
            <td class="c">${pct(c.prix)}</td>
            <td>${fmt(c.montantAdjuge)}</td>
            <td>${fmt(col5Value)}</td>
            <td>${fmt(c.couponCouru)}</td>
            <td>${fmt(c.montantNet)}</td>
          </tr>
          <tr>
            <td class="lbl" colspan="5">Commission de courtage : montant adjugé&nbsp;<sup>*</sup></td>
            <td class="c">${pct(TAUX_COMMISSION_COURTAGE * 100)}</td>
            <td>${fmt(c.commissionCourtage)}</td>
          </tr>
          <tr>
            <td class="lbl" colspan="5">TVA</td>
            <td class="c">${pct(TAUX_FVA * 100)}</td>
            <td>${fmt(c.fva)}</td>
          </tr>
          <tr class="net">
            <td class="lbl" colspan="6"><b>NET A DÉBITER</b></td>
            <td><b>${fmt(c.netADebite)}</b></td>
          </tr>
        </tbody>
      </table>

      <!-- Lignes Débit / Crédit -->
      <div class="ao-txts">
        <p>&nbsp;&nbsp;<i>Débit de votre compte ${compteEspeces} d'un montant net de ${fmt(c.netADebite)} FCFA représentant
        l'achat de ${fmt(volAdjuge)} ${nature} ${escapeHtml(o.isin)} ${libelle}</i></p>
        <p>&nbsp;&nbsp;<i>Crédit de votre compte titre de ${fmt(volAdjuge)} _${escapeHtml(o.isin)} ${libelle}</i></p>
      </div>

      <p>En vous remerciant de votre confiance, nous vous prions d'agréer, ${formule},
      l'expression de nos sentiments distingués.</p>

      <!-- Signature(s) des dirigeants habilités (Administration > Signatures) -->
      <div class="ao-sig">
        <div class="ao-sig-title">Pour Le SVT Afriland First Bank</div>
        ${renderSignatairesBanque(opts.signataires)}
      </div>

    </div><!-- /.ao-body -->
  </div><!-- /.ao-wrap -->

</body></html>`;
}

/** Génère et télécharge le PDF de l'avis d'opéré (calcul automatique). */
export async function downloadAvisOperePdf(
  o: import('../core/models/models').Order,
  em?: import('../core/models/models').Emission,
  opts: AvisOpereOptions = {},
  onProgress?: PdfProgress,
): Promise<void> {
  await renderSanitizedHtmlToPdf(buildAvisOpereHtml(o, em, opts), `AVIS-OPERE-${o.reference}.pdf`, onProgress);
}

/** Construit l'avis d'opéré en PDF et renvoie son data URI base64 — pour le
 *  transmettre au backend afin qu'il apparaisse dans le menu Documents du client. */
export async function buildAvisOperePdfDataUri(
  o: import('../core/models/models').Order,
  em?: import('../core/models/models').Emission,
  opts: AvisOpereOptions = {},
  onProgress?: PdfProgress,
): Promise<string> {
  return renderSanitizedHtmlToPdfDataUri(buildAvisOpereHtml(o, em, opts), onProgress);
}

/** Ouvre l'avis d'opéré dans un nouvel onglet et lance l'impression. */
export function printAvisOpere(
  o: import('../core/models/models').Order,
  em?: import('../core/models/models').Emission,
  opts: AvisOpereOptions = {},
): boolean {
  if (typeof window === 'undefined') return false;
  const html = buildAvisOpereHtml(o, em, opts);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank', 'noopener,noreferrer');
  if (!w) { URL.revokeObjectURL(url); return false; }
  try { w.addEventListener('load', () => { try { w.print(); } catch { /* ignore */ } }); } catch { /* ignore */ }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}



