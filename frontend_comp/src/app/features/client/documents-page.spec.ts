import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Type } from '@angular/core';
import { of, throwError } from 'rxjs';
import { DocumentsList } from './documents-page';
import { ApiService, DocumentItem } from '../../core/services/api';
import { ToastService } from '../../core/services/toast';
import { PdfProgressService } from '../../core/services/pdf-progress';

function doc(over: Partial<DocumentItem> = {}): DocumentItem {
  return {
    id: 'd1', reference: 'REF-1', type: 'AVIS_OPERATION', titre: 'Avis', clientId: 'u1',
    clientNom: 'John', uploadedBy: 'agent', mimeType: 'text/plain', taille: '10 Ko',
    telechargements: 0, dateGeneration: '2026-07-01', ...over,
  } as DocumentItem;
}

let api: any, toast: any, pdf: any;

function makeFakes(list: DocumentItem[] = []) {
  api = {
    listDocuments: vi.fn(() => of(list)),
    // Contenu texte inline-affichable (VIEW_INLINE_OK).
    getDocument: vi.fn(() => of(doc({ contenu: 'data:text/plain;base64,aGk=' }))),
  };
  toast = { success: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  pdf = { start: vi.fn(), set: vi.fn(), done: vi.fn(), fail: vi.fn() };
}

function configure(list: DocumentItem[] = []) {
  makeFakes(list);
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [DocumentsList],
    providers: [
      { provide: ApiService, useValue: api },
      { provide: ToastService, useValue: toast },
      { provide: PdfProgressService, useValue: pdf },
    ],
  });
}

function create(): DocumentsList {
  return TestBed.createComponent(DocumentsList as Type<DocumentsList>).componentInstance;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

// Neutralise les effets navigateur de openDocumentDataUri (blob + ouverture d'onglet).
let origCreate: any, origRevoke: any, origOpen: any;
beforeEach(() => {
  origCreate = (URL as any).createObjectURL;
  origRevoke = (URL as any).revokeObjectURL;
  origOpen = window.open;
  (URL as any).createObjectURL = vi.fn(() => 'blob:stub');
  (URL as any).revokeObjectURL = vi.fn();
  window.open = vi.fn() as any;
});
afterEach(() => {
  (URL as any).createObjectURL = origCreate;
  (URL as any).revokeObjectURL = origRevoke;
  window.open = origOpen;
});

describe('DocumentsList', () => {
  it('charge les documents au montage', () => {
    configure([doc(), doc({ id: 'd2' })]);
    const c = create();
    expect(api.listDocuments).toHaveBeenCalled();
    expect(c.documents().length).toBe(2);
  });

  it('vide la liste en cas d’erreur de chargement', () => {
    configure();
    api.listDocuments.mockReturnValueOnce(throwError(() => new Error('net')));
    const c = create();
    expect(c.documents()).toEqual([]);
  });

  it('filtre par type', () => {
    configure([
      doc({ id: 'a', type: 'AVIS_OPERATION' }),
      doc({ id: 'b', type: 'SITUATION_TITRES' }),
    ]);
    const c = create();
    expect(c.filtered().length).toBe(2);
    c.filterType.set('SITUATION_TITRES');
    expect(c.filtered().map((d) => d.id)).toEqual(['b']);
  });

  it('pagine par tranches de dix', () => {
    configure(Array.from({ length: 23 }, (_, i) => doc({ id: 'd' + i })));
    const c = create();
    expect(c.totalPages()).toBe(3);
    expect(c.pageItems().length).toBe(10);
    c.page.set(3);
    expect(c.pageItems().length).toBe(3);
  });

  it('typeLabel traduit les types connus et retombe sur la clé', () => {
    configure();
    const c = create();
    expect(c.typeLabel('ATTESTATION_PROPRIETE')).toBe('Attestation de propriété');
    expect(c.typeLabel('INCONNU')).toBe('INCONNU');
  });

  it('open consulte un document et clôt la progression', async () => {
    configure();
    const c = create();
    c.open('d1', 'view');
    expect(pdf.start).toHaveBeenCalled();
    await flush();
    expect(pdf.done).toHaveBeenCalled();
    expect(window.open).toHaveBeenCalled();
  });

  it('open en téléchargement notifie le succès', async () => {
    configure();
    const c = create();
    c.open('d1', 'download');
    await flush();
    expect(toast.success).toHaveBeenCalledWith('Téléchargement', 'REF-1');
  });

  it('open signale un document sans contenu', async () => {
    configure();
    api.getDocument.mockReturnValueOnce(of(doc({ contenu: undefined })));
    const c = create();
    c.open('d1', 'view');
    await flush();
    expect(pdf.fail).toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('Erreur', 'Document indisponible.');
  });

  it('open gère l’échec d’ouverture du fichier', async () => {
    configure();
    (URL as any).createObjectURL = vi.fn(() => { throw new Error('boom'); });
    const c = create();
    c.open('d1', 'view');
    await flush();
    expect(pdf.fail).toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('Erreur', "Impossible d'ouvrir le document.");
  });

  it('open gère l’échec de récupération du document', async () => {
    configure();
    api.getDocument.mockReturnValueOnce(throwError(() => new Error('net')));
    const c = create();
    c.open('d1', 'view');
    await flush();
    expect(pdf.fail).toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('Erreur', 'Document indisponible.');
  });
});
