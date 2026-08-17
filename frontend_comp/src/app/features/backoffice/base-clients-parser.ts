/**
 * Lecture du fichier « BASE CLIENTS » de la banque (Excel/CSV).
 *
 * <p>Le fichier est la source de vérité du référentiel : c'est lui qui dit
 * qui est déjà client. Les en-têtes varient d'un export à l'autre (accents,
 * majuscules, colonnes déplacées) — on les reconnaît donc par leur **libellé
 * normalisé** plutôt que par leur position.</p>
 */

/** Une ligne prête à être envoyée au backend. */
export interface LigneBaseClients {
  nomPrenom: string;
  /** 18 chiffres : agence(5) + compte(11) + clé(2). Le code banque 10005 est ajouté en base. */
  numeroCompte: string;
  agence: string;
  matricule: string;
  categorie: string;
  /** Compte de dépôt (compte-titres), ex. `CCEICMCXX345` — interne au back-office. */
  compteDepot: string;
  assujettiTaxes: string;
  localisation: string;
  dirigeant: string;
  telephone1: string;
  telephone2: string;
  email: string;
}

export interface ResultatAnalyse {
  lignes: LigneBaseClients[];
  /** En-têtes du fichier source — sert à réexporter les lignes en erreur. */
  entetes: string[];
  /**
   * Lignes écartées (numéro de compte absent ou mal formé), avec leur rang, le
   * motif, et les valeurs brutes de la ligne pour permettre de la réexporter et
   * la corriger.
   */
  rejets: Array<{ ligne: number; motif: string; valeurs: unknown[] }>;
}

/** Accents retirés, espaces compactés, minuscules : « NUMERO DE COMPTE » → « numero de compte ». */
export function normaliserEntete(s: string): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')   // diacritiques
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Libellés acceptés pour chaque colonne, dans l'ordre de préférence. */
const COLONNES: Record<keyof LigneBaseClients, string[]> = {
  nomPrenom: ['nom et prenom', 'nom & prenom', 'nom', 'raison sociale'],
  numeroCompte: ['numero de compte', 'numero compte', 'n de compte', 'compte'],
  agence: ['agence', 'code agence'],
  matricule: ['matricule'],
  categorie: ['categorie'],
  compteDepot: ['compte depot', 'compte de depot', 'compte depox', 'compte titres'],
  assujettiTaxes: ['assujetti taxes', 'assujetti aux taxes', 'assujetti'],
  localisation: ['localisation', 'ville'],
  dirigeant: ['dirigeant'],
  telephone1: ['telephone', 'telephone 1', 'telephone1', 'tel 1'],
  telephone2: ['telephone 2', 'telephone2', 'tel 2'],
  email: ['email', 'e-mail', 'mail'],
};

/**
 * Associe chaque colonne du fichier à un champ.
 *
 * <p>Le fichier porte DEUX colonnes « TELEPHONE » : la première rencontrée est
 * le téléphone 1, la seconde le téléphone 2. On ne réattribue donc jamais un
 * champ déjà pris — sans quoi la seconde écraserait la première.</p>
 */
export function associerColonnes(entetes: string[]): Partial<Record<keyof LigneBaseClients, number>> {
  const map: Partial<Record<keyof LigneBaseClients, number>> = {};
  const normalisees = entetes.map(normaliserEntete);

  for (const [champ, libelles] of Object.entries(COLONNES) as Array<[keyof LigneBaseClients, string[]]>) {
    for (const libelle of libelles) {
      const i = normalisees.findIndex(
        (e, idx) => e === libelle && !Object.values(map).includes(idx));
      if (i >= 0) { map[champ] = i; break; }
    }
  }

  // Deux colonnes « TELEPHONE » nues : la seconde alimente telephone2.
  if (map.telephone1 !== undefined && map.telephone2 === undefined) {
    const second = normalisees.findIndex(
      (e, idx) => idx !== map.telephone1 && COLONNES.telephone1.includes(e));
    if (second >= 0) map.telephone2 = second;
  }
  return map;
}

/** Chiffres seuls — le fichier écrit « 00090 56010090000 48 ». */
function chiffres(v: unknown): string {
  return String(v ?? '').replace(/\D/g, '');
}

function texte(v: unknown): string {
  return String(v ?? '').trim();
}

/**
 * Convertit les lignes brutes du tableur en lignes exploitables.
 *
 * <p>Une ligne sans numéro de compte exploitable est **écartée, pas fatale** :
 * le fichier de la banque contient des lignes de synthèse et des cellules vides
 * (« FIRST TRUST » n'a pas de numéro). Faire échouer tout l'import pour cela
 * serait absurde — on les signale à l'agent.</p>
 */
export function analyser(entetes: string[], lignes: unknown[][]): ResultatAnalyse {
  const map = associerColonnes(entetes);
  const resultat: ResultatAnalyse = { lignes: [], entetes, rejets: [] };

  const champ = (row: unknown[], nom: keyof LigneBaseClients): string => {
    const i = map[nom];
    return i === undefined ? '' : texte(row[i]);
  };

  lignes.forEach((row, idx) => {
    const numero = chiffres(champ(row, 'numeroCompte'));
    if (!numero) {
      if (row.some(c => texte(c))) {
        resultat.rejets.push({ ligne: idx + 2, motif: 'numéro de compte absent', valeurs: row });
      }
      return;   // ligne entièrement vide : on l'ignore en silence
    }
    if (numero.length !== 18) {
      resultat.rejets.push({
        ligne: idx + 2,
        motif: `numéro de ${numero.length} chiffres (18 attendus)`,
        valeurs: row,
      });
      return;
    }
    resultat.lignes.push({
      nomPrenom: champ(row, 'nomPrenom'),
      numeroCompte: numero,
      agence: chiffres(champ(row, 'agence')) || numero.slice(0, 5),
      matricule: champ(row, 'matricule'),
      categorie: champ(row, 'categorie'),
      compteDepot: champ(row, 'compteDepot'),
      assujettiTaxes: champ(row, 'assujettiTaxes'),
      localisation: champ(row, 'localisation'),
      dirigeant: champ(row, 'dirigeant'),
      telephone1: champ(row, 'telephone1'),
      telephone2: champ(row, 'telephone2'),
      email: champ(row, 'email'),
    });
  });

  return resultat;
}
