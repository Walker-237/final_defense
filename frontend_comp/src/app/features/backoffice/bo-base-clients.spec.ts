import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { BoBaseClients, decouperCsv, construireCsvErreurs } from './bo-base-clients';
import { ADMIN_CLIENTS_FB } from '../../core/services/api-endpoints';
import type { ResultatAnalyse } from './base-clients-parser';

/** URL d'une page du référentiel — la pagination se fait côté serveur. */
const page = (n: number, q?: string) =>
  `${ADMIN_CLIENTS_FB.LIST}?page=${n}&size=25${q ? `&q=${q}` : ''}`;

/** Réponse paginée : la page demandée + le TOTAL (jamais tronqué en silence). */
const reponse = (data: unknown[], total = data.length) => ({ data, page: 1, size: 25, total });

const CLIENT = {
  id: 'c1', nom_prenom: 'AFB', numero_compte: '000905601009000048',
  compte_especes: '10005000905601009000048', agence: '00090',
  categorie: 'Entreprises non financières', compte_depot: 'CCEICMCXX000',
  localisation: 'YAOUNDE', telephone1: '222223437', email: '',
};

describe('BoBaseClients', () => {
  let httpMock: HttpTestingController;

  function make() {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const fixture = TestBed.createComponent(BoBaseClients);
    httpMock = TestBed.inject(HttpTestingController);
    return fixture;
  }

  afterEach(() => httpMock.verify());

  it('charge la première page au démarrage', () => {
    const f = make();
    httpMock.expectOne(page(1)).flush(reponse([CLIENT], 4200));
    expect(f.componentInstance.clients()).toHaveLength(1);
    expect(f.componentInstance.clients()[0].compte_especes)
      .toBe('10005000905601009000048');
    // Le total porte sur TOUT le référentiel, pas sur la page affichée.
    expect(f.componentInstance.total()).toBe(4200);
  });

  it('demande la page voulue au serveur', () => {
    const f = make();
    httpMock.expectOne(page(1)).flush(reponse([], 4200));

    f.componentInstance.page.set(3);
    f.componentInstance.charger();
    httpMock.expectOne(page(3)).flush(reponse([CLIENT], 4200));
    expect(f.componentInstance.clients()).toHaveLength(1);
  });

  it('recherche par numéro de compte', () => {
    const f = make();
    httpMock.expectOne(page(1)).flush(reponse([]));
    f.componentInstance.recherche = 'AFB';
    f.componentInstance.rechercher();
    httpMock.expectOne(page(1, 'AFB')).flush(reponse([CLIENT]));
    expect(f.componentInstance.clients()).toHaveLength(1);
  });

  /** Une nouvelle recherche depuis la page 5 doit repartir de la première. */
  it('une recherche revient à la première page', () => {
    const f = make();
    httpMock.expectOne(page(1)).flush(reponse([], 4200));

    f.componentInstance.page.set(5);
    f.componentInstance.recherche = 'AFB';
    f.componentInstance.rechercher();

    expect(f.componentInstance.page()).toBe(1);
    httpMock.expectOne(page(1, 'AFB')).flush(reponse([CLIENT], 1));
  });

  it('poste les lignes analysées puis recharge la liste', () => {
    const f = make();
    httpMock.expectOne(page(1)).flush(reponse([]));

    f.componentInstance.analyse.set({
      lignes: [{
        nomPrenom: 'AFB', numeroCompte: '000905601009000048', agence: '00090',
        matricule: '5601009', categorie: 'Entreprises non financières',
        compteDepot: 'CCEICMCXX000', assujettiTaxes: 'OUI', localisation: 'YAOUNDE',
        dirigeant: 'Monsieur le Directeur Général', telephone1: '222223437',
        telephone2: '', email: '',
      }],
      entetes: [],
      rejets: [],
    });
    f.componentInstance.importer();

    const req = httpMock.expectOne(ADMIN_CLIENTS_FB.IMPORT);
    expect(req.request.body.lignes).toHaveLength(1);
    expect(req.request.body.lignes[0].numeroCompte).toBe('000905601009000048');
    req.flush({ importees: 1, ignorees: 0 });

    // L'analyse est vidée et la liste rechargée depuis la PREMIÈRE page : le
    // référentiel vient de changer de taille, la page courante peut avoir disparu.
    expect(f.componentInstance.analyse()).toBeNull();
    expect(f.componentInstance.page()).toBe(1);
    httpMock.expectOne(page(1)).flush(reponse([CLIENT]));
    expect(f.componentInstance.clients()).toHaveLength(1);
  });

  it('n’envoie rien quand aucune ligne n’est exploitable', () => {
    const f = make();
    httpMock.expectOne(page(1)).flush(reponse([]));
    f.componentInstance.analyse.set({ lignes: [], entetes: [], rejets: [{ ligne: 2, motif: 'vide', valeurs: [] }] });
    f.componentInstance.importer();
    httpMock.expectNone(ADMIN_CLIENTS_FB.IMPORT);
  });
});

describe('construireCsvErreurs', () => {
  it('exporte les lignes écartées avec leurs colonnes d’origine et le motif', () => {
    const a: ResultatAnalyse = {
      lignes: [],
      entetes: ['NOM', 'NUMERO DE COMPTE', 'CATEGORIE'],
      rejets: [
        { ligne: 3, motif: 'numéro de compte absent', valeurs: ['FIRST TRUST', '', 'Assurance'] },
        { ligne: 7, motif: 'numéro de 3 chiffres (18 attendus)', valeurs: ['X', '123', ''] },
      ],
    };
    const csv = construireCsvErreurs(a);
    const lignes = csv.split('\n');
    expect(lignes[0]).toBe("Ligne;NOM;NUMERO DE COMPTE;CATEGORIE;Motif d'erreur");
    expect(lignes[1]).toBe('3;FIRST TRUST;;Assurance;numéro de compte absent');
    // Motif sans séparateur CSV (« ; , " » ni saut de ligne) → non guillemeté.
    expect(lignes[2]).toBe('7;X;123;;numéro de 3 chiffres (18 attendus)');
  });

  it('dédoublonne les en-têtes répétés (deux colonnes TELEPHONE)', () => {
    const a: ResultatAnalyse = {
      lignes: [],
      entetes: ['NOM', 'TELEPHONE', 'TELEPHONE'],
      rejets: [{ ligne: 2, motif: 'vide', valeurs: ['A', '111', '222'] }],
    };
    const csv = construireCsvErreurs(a);
    const [entete, ligne] = csv.split('\n');
    expect(entete).toBe("Ligne;NOM;TELEPHONE;TELEPHONE (2);Motif d'erreur");
    expect(ligne).toBe('2;A;111;222;vide');
  });
});

describe('decouperCsv', () => {
  it('découpe sur la virgule et le point-virgule', () => {
    expect(decouperCsv('AFB;00090 56010090000 48;00090'))
      .toEqual(['AFB', '00090 56010090000 48', '00090']);
  });

  it('respecte les champs entre guillemets contenant un séparateur', () => {
    expect(decouperCsv('"BROTHERS, AND BROTHERS",00003'))
      .toEqual(['BROTHERS, AND BROTHERS', '00003']);
  });

  it('rend un guillemet littéral doublé', () => {
    expect(decouperCsv('"ETS ""SERAYIM""",00041')).toEqual(['ETS "SERAYIM"', '00041']);
  });
});
