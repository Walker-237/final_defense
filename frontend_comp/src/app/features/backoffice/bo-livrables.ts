import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, DocumentItem, UserAccount } from '../../core/services/api';
import { Position } from '../../core/models/models';
import { AuthService } from '../../core/services/auth-service';
import { ToastService } from '../../core/services/toast';
import { Paginator, PaginatePipe } from '../../shared/pagination';
import { openDocumentDataUri } from '../../shared/download';

/** Types de livrables proposés (CSFT §M4-F01 + dépôt libre). */
const DOC_TYPES: { value: string; label: string }[] = [
  { value: 'AVIS_OPERATION', label: "Avis d'opération" },
  { value: 'SITUATION_TITRES', label: 'Situation de titres' },
  { value: 'TABLEAU_AMORTISSEMENT', label: "Tableau d'amortissement" },
  { value: 'ATTESTATION_PROPRIETE', label: 'Attestation de propriété' },
  { value: 'SITUATION_PORTEFEUILLE', label: 'Situation de portefeuille' },
  { value: 'AUTRE', label: 'Autre document' },
];

/** Taille maximale d'un fichier téléversé (Mo). */
const MAX_FILE_MB = 15;

/** Types MIME autorisés (liste blanche stricte — alignée sur le backend). */
const ALLOWED_MIME = new Set([
  'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/csv', 'text/plain',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
]);

/**
 * Livrables (CSFT §M4) — côté agent SVT.
 *
 * L'agent téléverse un document, choisit le client destinataire ; le document
 * est persisté en base et devient consultable/téléchargeable par ce client.
 */
@Component({
  selector: 'afb-bo-livrables',
  imports: [FormsModule, Paginator, PaginatePipe],
  template: `
    <div>
      <div class="mb-6">
        <h1 class="text-xl sm:text-2xl font-bold">Livrables</h1>
        <p class="text-sm text-gray-500">Téléverser un document et l'attribuer à un client destinataire</p>
      </div>

      <!-- Génération serveur : situation de portefeuille (PDF édité à partir des positions) -->
      <div class="card mb-6">
        <div class="card-header">
          <h2 class="font-semibold">Situation de portefeuille titres</h2>
        </div>
        <div class="card-body grid grid-cols-1 sm:grid-cols-2 gap-4">
          <p class="sm:col-span-2 text-xs text-gray-500">
            Le relevé est généré par le système à partir des positions du client, puis transmis
            dans son espace. Aucun fichier à joindre.
          </p>
          <div>
            <label class="label">Client</label>
            <select class="select" [(ngModel)]="situForm.clientId" name="scl">
              <option value="">— Sélectionner —</option>
              @for (c of clients(); track c.id) {
                <option [value]="c.id">{{ c.nom }} {{ c.prenom || '' }} — {{ c.email }}</option>
              }
            </select>
          </div>
          <div>
            <label class="label">Période <span class="text-xs text-gray-400 font-normal">(défaut : aujourd'hui)</span></label>
            <input class="input" type="date" [(ngModel)]="situForm.periode" name="sper">
          </div>
          <div class="sm:col-span-2">
            <label class="label">Service <span class="text-xs text-gray-400 font-normal">(facultatif)</span></label>
            <input class="input" [(ngModel)]="situForm.service" name="ssvc" placeholder="ex. TRESORERIE" maxlength="60">
          </div>
          @if (situError()) { <div class="sm:col-span-2 text-sm text-red-600">{{ situError() }}</div> }
          <div class="sm:col-span-2 flex justify-end border-t pt-4">
            <button class="btn btn-primary" [disabled]="generatingSitu()" (click)="genererSituation()">
              {{ generatingSitu() ? 'Génération…' : '📄 Générer et transmettre' }}
            </button>
          </div>
        </div>
      </div>

      <!-- Génération serveur : attestation de propriété pour un titre détenu -->
      <div class="card mb-6">
        <div class="card-header">
          <h2 class="font-semibold">Attestation de propriété (par titre)</h2>
        </div>
        <div class="card-body grid grid-cols-1 sm:grid-cols-2 gap-4">
          <p class="sm:col-span-2 text-xs text-gray-500">
            Choisissez un client puis l'un des titres qu'il détient : l'attestation est générée
            par le système et transmise dans son espace.
          </p>
          <div>
            <label class="label">Client</label>
            <select class="select" [(ngModel)]="attForm.clientId" name="acl"
                    (ngModelChange)="onAttClient($event)">
              <option value="">— Sélectionner —</option>
              @for (c of clients(); track c.id) {
                <option [value]="c.id">{{ c.nom }} {{ c.prenom || '' }} — {{ c.email }}</option>
              }
            </select>
          </div>
          <div>
            <label class="label">Titre détenu</label>
            <select class="select" [(ngModel)]="attForm.isin" name="ais"
                    [disabled]="!attForm.clientId || attLoading()">
              <option value="">
                {{ attLoading() ? 'Chargement…'
                   : (attPositions().length ? '— Sélectionner —' : 'Aucun titre détenu') }}
              </option>
              @for (p of attPositions(); track p.isin) {
                <option [value]="p.isin">{{ p.emissionCode }} · {{ p.isin }} · {{ p.nature }}</option>
              }
            </select>
          </div>
          @if (attError()) { <div class="sm:col-span-2 text-sm text-red-600">{{ attError() }}</div> }
          <div class="sm:col-span-2 flex justify-end border-t pt-4">
            <button class="btn btn-primary"
                    [disabled]="generatingAtt() || !attForm.clientId || !attForm.isin"
                    (click)="genererAttestation()">
              {{ generatingAtt() ? 'Génération…' : '📄 Générer et transmettre' }}
            </button>
          </div>
        </div>
      </div>

      <div class="card mb-6">
        <div class="card-header"><h2 class="font-semibold">Nouveau livrable</h2></div>
        <div class="card-body grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="label">Client destinataire</label>
            <select class="select" [(ngModel)]="form.clientId" name="cl">
              <option value="">— Sélectionner —</option>
              @for (c of clients(); track c.id) {
                <option [value]="c.id">{{ c.nom }} {{ c.prenom || '' }} — {{ c.email }}</option>
              }
            </select>
          </div>
          <div>
            <label class="label">Type de document</label>
            <select class="select" [(ngModel)]="form.type" name="ty">
              @for (t of docTypes; track t.value) { <option [value]="t.value">{{ t.label }}</option> }
            </select>
          </div>
          <div class="sm:col-span-2">
            <label class="label">Intitulé</label>
            <input class="input" [(ngModel)]="form.titre" name="ti" placeholder="Intitulé du document">
          </div>
          <div class="sm:col-span-2">
            <label class="label">Fichier</label>
            <input class="input" type="file" (change)="onFile($event)" accept=".pdf,.png,.jpg,.jpeg,.csv,.xlsx">
            @if (form.fileName) {
              <p class="hint">📎 {{ form.fileName }} · {{ form.taille }}</p>
            }
          </div>
          @if (errorMsg()) { <div class="sm:col-span-2 text-sm text-red-600">{{ errorMsg() }}</div> }
          <div class="sm:col-span-2 flex justify-end border-t pt-4">
            <button class="btn btn-primary" [disabled]="saving()" (click)="upload()">{{ saving() ? 'Envoi…' : '📤 Téléverser et envoyer' }}</button>
          </div>
        </div>
      </div>

      <div class="card overflow-hidden">
        <div class="card-header"><h2 class="font-semibold">Livrables transmis ({{ documents().length }})</h2></div>
        <div class="overflow-x-auto"><table class="table min-w-[680px] sm:min-w-full">
          <thead><tr><th>Référence</th><th>Intitulé</th><th>Type</th><th>Destinataire</th><th>Date</th><th>Téléch.</th><th></th></tr></thead>
          <tbody>
            @for (d of (documents() | paginate:page():10); track d.id) {
              <tr>
                <td class="font-mono text-xs">{{ d.reference }}</td>
                <td class="text-sm font-medium">{{ d.titre }}</td>
                <td class="text-xs">{{ typeLabel(d.type) }}</td>
                <td class="text-sm">{{ d.clientNom }}</td>
                <td class="text-xs">{{ d.dateGeneration }}</td>
                <td class="text-center text-xs">{{ d.telechargements }}</td>
                <td>
                  <div class="flex gap-3">
                    <button class="text-afb-red text-sm" (click)="open(d.id, 'view')">👁 Voir</button>
                    <button class="text-afb-red text-sm" (click)="open(d.id, 'download')">⬇ Télécharger</button>
                  </div>
                </td>
              </tr>
            }
            @if (!documents().length) {
              <tr><td colspan="7" class="text-center py-12 text-gray-400 text-sm">Aucun livrable transmis</td></tr>
            }
          </tbody>
        </table></div>
        <afb-paginator [total]="documents().length" [pageSize]="10" [(page)]="page" />
      </div>
    </div>
  `,
})
export class BoLivrables {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  docTypes = DOC_TYPES;
  clients = signal<UserAccount[]>([]);
  documents = signal<DocumentItem[]>([]);
  saving = signal(false);
  errorMsg = signal('');
  page = signal(1);

  form = { clientId: '', type: 'AVIS_OPERATION', titre: '', fileName: '', mimeType: '', taille: '', contenu: '' };

  // Génération serveur de la situation de portefeuille.
  situForm = { clientId: '', periode: '', service: 'TRESORERIE' };
  generatingSitu = signal(false);
  situError = signal('');

  // Attestation de propriété par titre : on charge les positions du client choisi.
  attForm = { clientId: '', isin: '' };
  attPositions = signal<Position[]>([]);
  attLoading = signal(false);
  generatingAtt = signal(false);
  attError = signal('');

  constructor() {
    this.api.listClients().subscribe({ next: (c) => this.clients.set(c), error: () => {} });
    this.loadDocuments();
  }

  typeLabel(t: string) {
    return DOC_TYPES.find((x) => x.value === t)?.label ?? t;
  }

  /** Consulte ou télécharge un livrable déjà transmis (vérification agent). */
  open(id: string, mode: 'view' | 'download') {
    this.api.getDocument(id).subscribe({
      next: async (d) => {
        if (!d.contenu) {
          this.toast.error('Erreur', 'Document indisponible.');
          return;
        }
        try {
          await openDocumentDataUri(d.contenu, d.titre, d.reference, d.mimeType, mode);
          if (mode === 'download') this.toast.success('Téléchargement', d.reference);
        } catch {
          this.toast.error('Erreur', "Impossible d'ouvrir le document.");
        }
        this.loadDocuments();
      },
      error: () => this.toast.error('Erreur', 'Document indisponible.'),
    });
  }

  /** Génère la situation de portefeuille du client et l'ouvre pour vérification. */
  genererSituation() {
    this.situError.set('');
    const f = this.situForm;
    if (!f.clientId) { this.situError.set('Sélectionnez un client.'); return; }

    this.generatingSitu.set(true);
    this.api
      .generateSituationPortefeuille({
        clientId: f.clientId,
        periode: f.periode || undefined,
        service: f.service?.trim() || undefined,
      })
      .subscribe({
        next: (d) => {
          this.generatingSitu.set(false);
          this.toast.success('Situation transmise', `${d.reference} → ${d.clientNom}`);
          this.situForm = { clientId: '', periode: '', service: 'TRESORERIE' };
          this.loadDocuments();
          this.open(d.id, 'view'); // aperçu immédiat pour l'agent
        },
        error: (err) => {
          this.generatingSitu.set(false);
          this.situError.set(this.auth.errorMessage(err));
        },
      });
  }

  /** Charge les titres détenus par le client choisi (pour le sélecteur de titre). */
  onAttClient(clientId: string) {
    this.attForm.isin = '';
    this.attPositions.set([]);
    this.attError.set('');
    if (!clientId) return;
    this.attLoading.set(true);
    this.api.getClientPortfolio(clientId).subscribe({
      next: (r) => { this.attPositions.set(r.positions ?? []); this.attLoading.set(false); },
      error: () => { this.attPositions.set([]); this.attLoading.set(false); },
    });
  }

  /** Génère l'attestation de propriété pour le titre choisi et l'ouvre. */
  genererAttestation() {
    this.attError.set('');
    const f = this.attForm;
    if (!f.clientId || !f.isin) { this.attError.set('Sélectionnez un client et un titre.'); return; }

    this.generatingAtt.set(true);
    this.api.generateAttestationClient({ clientId: f.clientId, isin: f.isin }).subscribe({
      next: (d) => {
        this.generatingAtt.set(false);
        this.toast.success('Attestation transmise', `${d.reference} → ${d.clientNom}`);
        this.attForm = { clientId: '', isin: '' };
        this.attPositions.set([]);
        this.loadDocuments();
        this.open(d.id, 'view');
      },
      error: (err) => {
        this.generatingAtt.set(false);
        this.attError.set(this.auth.errorMessage(err));
      },
    });
  }

  private loadDocuments() {
    this.api.listDocuments().subscribe({
      next: (d) => this.documents.set(d),
      error: () => this.documents.set([]),
    });
  }

  onFile(ev: Event) {
    this.errorMsg.set('');
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      this.errorMsg.set(`Fichier trop volumineux (${MAX_FILE_MB} Mo maximum).`);
      input.value = '';
      return;
    }
    const mime = (file.type || '').split(';')[0].trim().toLowerCase();
    if (!ALLOWED_MIME.has(mime)) {
      this.errorMsg.set('Type de fichier non autorisé (PDF, PNG, JPEG, WEBP, CSV, XLS(X), TXT).');
      input.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      this.form.contenu = reader.result as string;
      this.form.mimeType = file.type || 'application/octet-stream';
      this.form.taille = this.humanSize(file.size);
      this.form.fileName = file.name;
      if (!this.form.titre) this.form.titre = file.name;
    };
    reader.readAsDataURL(file);
  }

  upload() {
    this.errorMsg.set('');
    const f = this.form;
    if (!f.clientId) { this.errorMsg.set('Sélectionnez un client destinataire.'); return; }
    if (!f.contenu) { this.errorMsg.set('Sélectionnez un fichier.'); return; }
    if (!f.titre.trim()) { this.errorMsg.set("L'intitulé est obligatoire."); return; }

    this.saving.set(true);
    this.api
      .uploadDocument({
        clientId: f.clientId,
        type: f.type,
        titre: f.titre.trim(),
        mimeType: f.mimeType || 'application/pdf',
        taille: f.taille,
        contenu: f.contenu,
      })
      .subscribe({
        next: (d) => {
          this.saving.set(false);
          this.toast.success('Livrable transmis', `${d.reference} → ${d.clientNom}`);
          this.form = { clientId: '', type: 'AVIS_OPERATION', titre: '', fileName: '', mimeType: '', taille: '', contenu: '' };
          this.loadDocuments();
        },
        error: (err) => {
          this.saving.set(false);
          this.errorMsg.set(this.auth.errorMessage(err));
        },
      });
  }

  private humanSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} o`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
    return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
  }
}
