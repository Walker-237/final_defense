import { Component, inject, output, signal } from '@angular/core';
import { AnalysePiece, IdDocumentService, TypePiece } from './id-document-service';
import { DocumentCameraComponent } from './document-camera';

/** Pièce validée, prête à être envoyée au backend. */
export interface PieceIdentite {
  imageBase64: string;
  cote: 'RECTO' | 'VERSO';
  /** Type reconnu par l'OCR, ou null : purement indicatif (le BO tranche). */
  type: TypePiece | null;
  texte: string;
  nettete: number;
  largeur: number;
  hauteur: number;
}

const LIBELLES: Record<TypePiece, string> = {
  CNI: "Carte nationale d'identité",
  PASSEPORT: 'Passeport',
  CARTE_SEJOUR: 'Carte de séjour',
};

/**
 * Téléversement d'une pièce d'identité (CNI recto/verso, carte de séjour, passeport).
 *
 * <p>Seule la <b>qualité de l'image</b> conditionne l'acceptation (nette et assez
 * grande). La reconnaissance automatique du type de pièce a été retirée : elle
 * refusait des pièces valables. Le texte lu est transmis au back-office, qui
 * reste seul juge de la validité du document.</p>
 */
@Component({
  selector: 'afb-id-document-upload',
  standalone: true,
  imports: [DocumentCameraComponent],
  template: `
    <div class="space-y-3">
      @for (cote of cotes; track cote) {
        <div class="rounded-lg border p-3"
             [class.border-emerald-300]="valide(cote)"
             [class.bg-emerald-50]="valide(cote)"
             [class.border-gray-200]="!valide(cote)">
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs font-semibold text-gray-600">
              {{ cote === 'RECTO' ? 'Recto' : 'Verso' }}
              @if (cote === 'VERSO') { <span class="font-normal text-gray-400">(facultatif pour un passeport)</span> }
            </span>
            @if (valide(cote)) {
              <span class="text-xs text-emerald-700">✓ {{ libelle(cote) }}</span>
            }
          </div>

          @if (valide(cote)) {
            <div class="flex items-center gap-3 mt-2">
              <img [src]="apercu(cote)" alt="Pièce d'identité" class="h-16 rounded border bg-white object-contain">
              <div class="text-[11px] text-gray-500 flex-1">
                Mentions lues : {{ champs(cote) }}
              </div>
              <button type="button" class="text-xs text-afb-red underline" (click)="reinitialiser(cote)">Remplacer</button>
            </div>
          } @else if (camera() === cote) {
            <!-- Prise de vue directe de la pièce -->
            <div class="mt-2">
              <afb-document-camera
                (captured)="onPhoto($event, cote)"
                (annuler)="camera.set(null)" />
            </div>
          } @else {
            <!-- Deux façons de fournir la pièce : import ou prise de vue -->
            <div class="mt-2 flex flex-col sm:flex-row gap-2">
              <label class="btn btn-outline text-xs flex-1 cursor-pointer text-center"
                     [class.opacity-50]="analyse() === cote">
                📁 Importer un fichier
                <input type="file" accept="image/*" class="hidden"
                       [disabled]="analyse() === cote"
                       (change)="onFichier($event, cote)">
              </label>
              <button type="button" class="btn btn-outline text-xs flex-1"
                      [disabled]="analyse() === cote"
                      (click)="camera.set(cote)">
                📷 Photographier la pièce
              </button>
            </div>

            @if (analyse() === cote) {
              <p class="text-[11px] text-gray-500 mt-1">Analyse du document en cours (lecture du texte)…</p>
            }
            @for (m of motifs(cote); track m) {
              <p class="text-[11px] text-afb-red mt-1">✕ {{ m }}</p>
            }
          }
        </div>
      }

      <p class="text-[11px] text-gray-400">
        Pièces acceptées : carte nationale d'identité, carte de séjour ou passeport.
        Photo nette, document bien à plat et lisible — elle sera vérifiée par la banque.
      </p>
    </div>
  `,
})
export class IdDocumentUpload {
  private readonly docs = inject(IdDocumentService);

  readonly cotes: Array<'RECTO' | 'VERSO'> = ['RECTO', 'VERSO'];

  /** Émis à chaque changement : liste des pièces validées. */
  readonly pieces = output<PieceIdentite[]>();

  /** Côté en cours d'analyse (désactive l'entrée). */
  readonly analyse = signal<'RECTO' | 'VERSO' | null>(null);
  /** Côté dont la caméra est ouverte (prise de vue directe de la pièce). */
  readonly camera = signal<'RECTO' | 'VERSO' | null>(null);

  private readonly validees = signal<Record<string, PieceIdentite>>({});
  private readonly refus = signal<Record<string, string[]>>({});
  private readonly apercus = signal<Record<string, string>>({});
  private readonly champsLus = signal<Record<string, string[]>>({});

  valide(cote: string): boolean { return !!this.validees()[cote]; }
  apercu(cote: string): string { return this.apercus()[cote] ?? ''; }
  motifs(cote: string): string[] { return this.refus()[cote] ?? []; }
  champs(cote: string): string { return (this.champsLus()[cote] ?? []).join(', ') || '—'; }
  /** Libellé du type SI l'OCR l'a reconnu ; sinon mention neutre (jamais bloquant). */
  libelle(cote: string): string {
    const t = this.validees()[cote]?.type;
    return t ? LIBELLES[t] : "Pièce d'identité";
  }

  /** Pièce importée depuis un fichier. */
  async onFichier(ev: Event, cote: 'RECTO' | 'VERSO'): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const accepte = await this.traiterImage(await this.lire(file), cote);
    if (!accepte) input.value = '';   // permet de re-sélectionner le même fichier
  }

  /** Pièce photographiée par la caméra — même contrôle que pour un import. */
  async onPhoto(dataUrl: string, cote: 'RECTO' | 'VERSO'): Promise<void> {
    this.camera.set(null);
    await this.traiterImage(dataUrl, cote);
  }

  /**
   * Analyse commune (qualité de l'image). Qu'elle vienne d'un fichier ou de la
   * caméra, une pièce subit exactement les mêmes contrôles — sinon la photo
   * serait une porte dérobée.
   *
   * @returns vrai si la pièce a été acceptée.
   */
  private async traiterImage(dataUrl: string, cote: 'RECTO' | 'VERSO'): Promise<boolean> {
    this.analyse.set(cote);
    this.refus.update(r => ({ ...r, [cote]: [] }));

    try {
      const a: AnalysePiece = await this.docs.analyser(dataUrl);

      if (!a.ok) {
        // Motif par défaut si l'analyse n'a rien pu conclure.
        const motifs = a.motifs.length ? a.motifs : ['Document non exploitable.'];
        this.refus.update(r => ({ ...r, [cote]: motifs }));
        return false;
      }

      this.apercus.update(p => ({ ...p, [cote]: dataUrl }));
      this.champsLus.update(c => ({ ...c, [cote]: a.champsDetectes }));
      this.validees.update(v => ({
        ...v,
        [cote]: {
          imageBase64: dataUrl, cote, type: a.type, texte: a.texte,
          nettete: a.nettete, largeur: a.largeur, hauteur: a.hauteur,
        },
      }));
      this.emettre();
      return true;
    } finally {
      this.analyse.set(null);
    }
  }

  reinitialiser(cote: string): void {
    this.camera.set(null);
    this.refus.update(r => ({ ...r, [cote]: [] }));
    this.validees.update(v => { const c = { ...v }; delete c[cote]; return c; });
    this.apercus.update(p => { const c = { ...p }; delete c[cote]; return c; });
    this.champsLus.update(x => { const c = { ...x }; delete c[cote]; return c; });
    this.emettre();
  }

  private emettre(): void {
    this.pieces.emit(Object.values(this.validees()));
  }

  private lire(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('fichier illisible'));
      reader.readAsDataURL(file);
    });
  }
}
