import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { SIGNATURES_DIRIGEANTS } from '../../core/services/api-endpoints';
import { ToastService } from '../../core/services/toast';
import { ConfirmDialog } from '../../shared/dialogs';

export interface SignatureDirigeant {
  id: string;
  nom: string;
  fonction: string;
  signatureData: string;
  actif: boolean;
  ordre: number;
}

/** Formats acceptés côté serveur (data URI image, 512 Ko max). */
const TYPES_OK = ['image/png', 'image/jpeg', 'image/webp'];
const TAILLE_MAX = 512 * 1024;

/**
 * Administration — signatures des dirigeants.
 *
 * <p>Les signatures <b>actives</b> sont apposées automatiquement sur les
 * documents générés par la plateforme (avis d'opéré, attestations), dans
 * l'ordre défini ici.</p>
 */
@Component({
  selector: 'afb-bo-signatures',
  standalone: true,
  imports: [FormsModule, ConfirmDialog],
  template: `
    <div class="max-w-4xl">
      <div class="mb-6">
        <h1 class="text-xl sm:text-2xl font-bold">Administration · Signatures des dirigeants</h1>
        <p class="text-sm text-gray-500">
          Les signatures actives sont apposées sur les documents générés par la plateforme
          (avis d'opéré, attestations), dans l'ordre indiqué.
        </p>
      </div>

      <!-- Ajout / modification -->
      <div class="card mb-6">
        <div class="card-header">
          <h2 class="font-semibold text-sm">{{ editId() ? 'Modifier la signature' : 'Ajouter une signature' }}</h2>
        </div>
        <div class="card-body space-y-4">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="label">Nom</label>
              <input class="input" [(ngModel)]="form.nom" name="nom" placeholder="FOTSO Marie">
            </div>
            <div>
              <label class="label">Fonction</label>
              <input class="input" [(ngModel)]="form.fonction" name="fonction" placeholder="Directeur Général">
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="label">Image de la signature <span class="text-xs text-gray-400 font-normal">(PNG, JPEG ou WEBP · 512 Ko max)</span></label>
              <input type="file" accept="image/png,image/jpeg,image/webp" class="block w-full text-xs"
                     (change)="onFichier($event)">
              @if (erreur()) { <p class="text-xs text-afb-red mt-1">{{ erreur() }}</p> }
            </div>
            <div class="flex items-end gap-4">
              <div>
                <label class="label">Ordre</label>
                <input class="input w-20" type="number" min="0" [(ngModel)]="form.ordre" name="ordre">
              </div>
              <label class="flex items-center gap-2 text-sm pb-2">
                <input type="checkbox" [(ngModel)]="form.actif" name="actif">
                Active (apposée sur les documents)
              </label>
            </div>
          </div>

          @if (form.signatureData) {
            <div class="rounded-lg border bg-white p-3 inline-block">
              <img [src]="form.signatureData" alt="Aperçu de la signature" class="h-16 object-contain">
            </div>
          }

          <div class="flex gap-2">
            <button type="button" class="btn btn-primary text-sm" [disabled]="!valide() || busy()" (click)="enregistrer()">
              {{ editId() ? 'Enregistrer les modifications' : 'Ajouter la signature' }}
            </button>
            @if (editId()) {
              <button type="button" class="btn btn-outline text-sm" (click)="annuler()">Annuler</button>
            }
          </div>
        </div>
      </div>

      <!-- Liste -->
      <div class="card">
        <div class="card-header"><h2 class="font-semibold text-sm">Signatures enregistrées</h2></div>
        <div class="overflow-x-auto">
          <table class="table min-w-[640px] text-sm">
            <thead><tr><th>Signature</th><th>Nom</th><th>Fonction</th><th>Ordre</th><th>État</th><th></th></tr></thead>
            <tbody>
              @for (s of signatures(); track s.id) {
                <tr>
                  <td><img [src]="s.signatureData" alt="Signature de {{ s.nom }}" class="h-10 object-contain"></td>
                  <td class="font-semibold">{{ s.nom }}</td>
                  <td>{{ s.fonction }}</td>
                  <td>{{ s.ordre }}</td>
                  <td>
                    <span class="badge" [class.bg-emerald-100]="s.actif" [class.text-emerald-700]="s.actif"
                          [class.bg-gray-100]="!s.actif" [class.text-gray-600]="!s.actif">
                      {{ s.actif ? 'Active' : 'Inactive' }}
                    </span>
                  </td>
                  <td class="text-right whitespace-nowrap">
                    <button class="text-afb-red text-xs mr-3" (click)="editer(s)">Modifier</button>
                    <button class="text-gray-500 text-xs" (click)="demanderSuppression(s)">Supprimer</button>
                  </td>
                </tr>
              } @empty {
                <tr><td colspan="6" class="text-center text-gray-400 text-xs py-6">
                  Aucune signature enregistrée — les documents seront générés sans signature de la banque.
                </td></tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <afb-confirm-dialog [open]="suppressionOpen()"
      title="Supprimer cette signature"
      [message]="messageSuppression()"
      confirmLabel="Supprimer" [danger]="true"
      (confirm)="supprimer()" (cancel)="suppressionOpen.set(false)" />
  `,
})
export class BoSignatures {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);

  readonly signatures = signal<SignatureDirigeant[]>([]);
  readonly editId = signal<string | null>(null);
  readonly busy = signal(false);
  readonly erreur = signal('');
  readonly suppressionOpen = signal(false);
  private aSupprimer: SignatureDirigeant | null = null;

  form: { nom: string; fonction: string; signatureData: string; actif: boolean; ordre: number } = {
    nom: '', fonction: '', signatureData: '', actif: true, ordre: 0,
  };

  constructor() {
    this.charger();
  }

  private charger(): void {
    this.http.get<SignatureDirigeant[]>(SIGNATURES_DIRIGEANTS.LIST).subscribe({
      next: (rows) => this.signatures.set(rows ?? []),
      error: () => this.toast.error('Chargement des signatures impossible.'),
    });
  }

  valide(): boolean {
    return !!(this.form.nom.trim() && this.form.fonction.trim() && this.form.signatureData);
  }

  onFichier(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.erreur.set('');

    if (!TYPES_OK.includes(file.type)) {
      this.erreur.set('Format non accepté : utilisez un PNG, un JPEG ou un WEBP.');
      input.value = '';
      return;
    }
    if (file.size > TAILLE_MAX) {
      this.erreur.set('Image trop volumineuse (512 Ko maximum).');
      input.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => { this.form.signatureData = String(reader.result); };
    reader.onerror = () => this.erreur.set('Fichier illisible.');
    reader.readAsDataURL(file);
  }

  enregistrer(): void {
    if (!this.valide() || this.busy()) return;
    this.busy.set(true);
    const id = this.editId();
    const corps = {
      nom: this.form.nom.trim(), fonction: this.form.fonction.trim(),
      signatureData: this.form.signatureData,
      actif: this.form.actif, ordre: Number(this.form.ordre) || 0,
    };
    const appel = id
      ? this.http.patch(SIGNATURES_DIRIGEANTS.UPDATE(id), corps)
      : this.http.post(SIGNATURES_DIRIGEANTS.CREATE, corps);

    appel.subscribe({
      next: () => {
        this.toast.success(id ? 'Signature modifiée' : 'Signature ajoutée');
        this.annuler();
        this.charger();
        this.busy.set(false);
      },
      error: () => { this.toast.error('Enregistrement impossible.'); this.busy.set(false); },
    });
  }

  editer(s: SignatureDirigeant): void {
    this.editId.set(s.id);
    this.form = {
      nom: s.nom, fonction: s.fonction, signatureData: s.signatureData,
      actif: s.actif, ordre: s.ordre,
    };
  }

  annuler(): void {
    this.editId.set(null);
    this.erreur.set('');
    this.form = { nom: '', fonction: '', signatureData: '', actif: true, ordre: 0 };
  }

  demanderSuppression(s: SignatureDirigeant): void {
    this.aSupprimer = s;
    this.suppressionOpen.set(true);
  }

  messageSuppression(): string {
    const s = this.aSupprimer;
    return s
      ? `La signature de ${s.nom} (${s.fonction}) ne sera plus apposée sur les documents.`
      : '';
  }

  supprimer(): void {
    const s = this.aSupprimer;
    this.suppressionOpen.set(false);
    if (!s) return;
    this.http.delete(SIGNATURES_DIRIGEANTS.DELETE(s.id)).subscribe({
      next: () => { this.toast.success('Signature supprimée'); this.charger(); },
      error: () => this.toast.error('Suppression impossible.'),
    });
  }
}
