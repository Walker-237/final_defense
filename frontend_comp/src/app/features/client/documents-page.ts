import { Component, computed, inject, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, DocumentItem } from '../../core/services/api';
import { ToastService } from '../../core/services/toast';
import { PdfProgressService } from '../../core/services/pdf-progress';
import { openDocumentDataUri } from '../../shared/download';

/** Libellés des types de livrables (CSFT §M4-F01). */
const TYPE_LABELS: Record<string, string> = {
  AVIS_OPERATION: "Avis d'opération",
  AVIS_OFFRE_NON_ADJUGEE: "Avis d'offre non adjugée",
  SITUATION_TITRES: 'Situation de titres',
  TABLEAU_AMORTISSEMENT: "Tableau d'amortissement",
  ATTESTATION_PROPRIETE: 'Attestation de propriété',
  AUTRE: 'Autre document',
};

/**
 * Mes documents (CSFT §M4) — côté client.
 *
 * Liste les livrables que l'agent SVT a transmis au client connecté ; le
 * client peut les consulter ou les télécharger. Le périmètre est cloisonné
 * côté backend (un client ne reçoit que ses propres documents).
 */
@Component({
  selector: 'afb-documents',
  imports: [FormsModule],
  template: `
    <div>
      <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 class="text-xl sm:text-2xl font-bold">Mes documents</h1>
          <p class="text-sm text-gray-500">Livrables transmis par votre teneur de compte</p>
        </div>
        <select class="select w-auto" [ngModel]="filterType()" (ngModelChange)="filterType.set($event); page.set(1)" name="ft">
          <option value="">Tous les types</option>
          @for (t of typeKeys; track t) { <option [value]="t">{{ typeLabel(t) }}</option> }
        </select>
      </div>

      <div class="card overflow-hidden">
        <div class="overflow-x-auto"><table class="table min-w-[680px] sm:min-w-full">
          <thead><tr><th>Référence</th><th>Intitulé</th><th>Type</th><th>Date</th><th>Taille</th><th></th></tr></thead>
          <tbody>
            @for (d of pageItems(); track d.id) {
              <tr>
                <td class="font-mono text-xs font-semibold">{{ d.reference }}</td>
                <td class="text-sm font-medium">{{ d.titre }}</td>
                <td><span class="badge bg-purple-100 text-purple-700">{{ typeLabel(d.type) }}</span></td>
                <td class="text-xs">{{ d.dateGeneration }}</td>
                <td class="text-xs">{{ d.taille || '—' }}</td>
                <td>
                  <div class="flex gap-3">
                    <button class="text-afb-red text-sm" (click)="open(d.id, 'view')">👁 Consulter</button>
                  </div>
                </td>
              </tr>
            }
            @if (!filtered().length) {
              <tr><td colspan="6" class="text-center py-12 text-gray-400 text-sm">Aucun document disponible</td></tr>
            }
          </tbody>
        </table></div>
        @if (totalPages() > 1) {
          <div class="flex items-center justify-between px-4 py-3 border-t text-sm">
            <span class="text-gray-500">{{ filtered().length }} document(s)</span>
            <div class="flex gap-2">
              <button class="btn btn-outline btn-sm" [disabled]="page() === 1" (click)="page.set(page() - 1)">‹</button>
              <span class="px-2 py-1">{{ page() }} / {{ totalPages() }}</span>
              <button class="btn btn-outline btn-sm" [disabled]="page() === totalPages()" (click)="page.set(page() + 1)">›</button>
            </div>
          </div>
        }
      </div>
    </div>
  `,
})
export class DocumentsList {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private pdfProgress = inject(PdfProgressService);
  private readonly PAGE_SIZE = 10;

  documents = signal<DocumentItem[]>([]);
  filterType = model('');
  page = signal(1);
  typeKeys = Object.keys(TYPE_LABELS);

  constructor() {
    this.load();
  }

  filtered = computed(() => {
    const ft = this.filterType();
    return this.documents().filter((d) => !ft || d.type === ft);
  });

  totalPages = computed(() => Math.max(1, Math.ceil(this.filtered().length / this.PAGE_SIZE)));

  pageItems = computed(() => {
    const start = (Math.min(this.page(), this.totalPages()) - 1) * this.PAGE_SIZE;
    return this.filtered().slice(start, start + this.PAGE_SIZE);
  });

  typeLabel(t: string) {
    return TYPE_LABELS[t] ?? t;
  }

  private load() {
    this.api.listDocuments().subscribe({
      next: (d) => this.documents.set(d),
      error: () => this.documents.set([]),
    });
  }

  /** Consulte ou télécharge un livrable — barre de progression pendant le transfert. */
  open(id: string, mode: 'view' | 'download') {
    const label = mode === 'download' ? 'Téléchargement en cours…' : 'Chargement du document…';
    this.pdfProgress.start(label);
    this.pdfProgress.set(20, label);
    this.api.getDocument(id).subscribe({
      next: async (d) => {
        this.pdfProgress.set(80, mode === 'download' ? 'Préparation du fichier…' : 'Ouverture…');
        if (!d.contenu) {
          this.pdfProgress.fail();
          this.toast.error('Erreur', 'Document indisponible.');
          return;
        }
        try {
          await openDocumentDataUri(d.contenu, d.titre, d.reference, d.mimeType, mode);
          this.pdfProgress.done();
          if (mode === 'download') this.toast.success('Téléchargement', d.reference);
        } catch {
          this.pdfProgress.fail();
          this.toast.error('Erreur', "Impossible d'ouvrir le document.");
        }
        this.load();
      },
      error: () => {
        this.pdfProgress.fail();
        this.toast.error('Erreur', 'Document indisponible.');
      },
    });
  }
}
