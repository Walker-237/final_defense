import { Component, ElementRef, QueryList, ViewChildren, inject, signal } from '@angular/core';
import { RouterLink, Router, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { finalize, forkJoin } from 'rxjs';
import { SignatureField } from '../../shared/signature-pad';
import { AuthService } from '../../core/services/auth-service';
import { MockData } from '../../core/services/mock-data';
import { safeReturnUrl } from '../../core/services/auth-guard';
import { isValidEmail } from '../../shared/validation';
import { ToastService } from '../../core/services/toast';
import { FaceScanComponent, FaceCaptureResult } from '../registration/face-scan';
import { RegistrationService } from '../registration/registration-service';
import { ConventionReaderDialog } from '../registration/convention-reader';
import { IdDocumentUpload, PieceIdentite } from '../registration/id-document-upload';
import { MasqueDirective } from '../../shared/masque.directive';
import { compteComplet, chiffres, telephoneInternational } from '../../shared/masques';

@Component({
  selector: 'afb-login',
  imports: [RouterLink, FormsModule],
  template: `
    <div class="w-full max-w-md">
      <div class="card">
        <div class="p-8">
          <h1 class="text-2xl font-bold text-gray-900">Connexion</h1>
          <p class="text-sm text-gray-500 mt-1">Accédez à votre espace investisseur sécurisé</p>
          <form (ngSubmit)="submit()" class="mt-6 space-y-4">
            <div>
              <label class="label">Identifiant / E-mail</label>
              <input class="input" type="email" autocomplete="username"
                     [(ngModel)]="email" name="email" placeholder="prenom.nom@exemple.cm"
                     (blur)="touchEmail()" (ngModelChange)="emailErr() && touchEmail()">
              @if (emailErr()) { <p class="text-xs text-red-600 mt-1">{{ emailErr() }}</p> }
            </div>
            <div>
              <label class="label flex justify-between">Mot de passe <a routerLink="/auth/forgot" class="text-xs text-afb-red font-normal">Oublié ?</a></label>
              <input class="input" type="password" autocomplete="current-password"
                     [(ngModel)]="password" name="password" placeholder="••••••••"
                     (blur)="touchPassword()" (ngModelChange)="passwordErr() && touchPassword()">
              @if (passwordErr()) { <p class="text-xs text-red-600 mt-1">{{ passwordErr() }}</p> }
              @if (errorMsg()) { <p class="text-xs text-red-600 mt-1">{{ errorMsg() }}</p> }
            </div>
            <label class="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox"> Se souvenir de moi</label>
            <button type="submit" class="btn btn-primary w-full" [disabled]="loading()">{{ loading() ? 'Connexion…' : 'Se connecter' }}</button>
          </form>
          <div class="mt-5 pt-5 border-t border-gray-100 text-center text-sm text-gray-500">
            Pas encore client ? <a routerLink="/auth/register" class="text-afb-red font-medium">Ouvrir un compte-titres</a>
          </div>
        </div>
      </div>
      <p class="text-[11px] text-gray-400 text-center mt-4">Connexion sécurisée · authentification à deux facteurs</p>
    </div>
  `
})
export class LoginPage {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);
  email = '';
  password = '';
  emailErr = signal('');
  passwordErr = signal('');
  errorMsg = signal('');
  loading = signal(false);

  touchEmail() {
    this.emailErr.set(!this.email ? 'L\'e-mail est requis.' :
                      !isValidEmail(this.email) ? 'Format d\'e-mail invalide.' : '');
  }
  touchPassword() {
    this.passwordErr.set(!this.password ? 'Le mot de passe est requis.' :
                         this.password.length < 8 ? '8 caractères minimum.' : '');
  }

  submit() {
    this.touchEmail();
    this.touchPassword();
    if (this.emailErr() || this.passwordErr()) return;
    this.errorMsg.set('');
    if (this.loading()) return;

    const returnUrl = safeReturnUrl(this.route.snapshot.queryParamMap.get('returnUrl'));
    this.loading.set(true);
    this.auth.login(this.email, this.password, returnUrl)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: () => {
          this.password = '';
          this.router.navigateByUrl('/auth/mfa');
        },
        error: (err) => {
          this.errorMsg.set(this.auth.errorMessage(err));
        },
      });
  }
}

@Component({
  selector: 'afb-change-password',
  imports: [FormsModule],
  template: `
    <div class="w-full max-w-md">
      <div class="card">
        <div class="p-8">
          <h1 class="text-2xl font-bold text-gray-900">Définir votre mot de passe</h1>
          <p class="text-sm text-gray-500 mt-1">
            Pour votre sécurité, remplacez le mot de passe provisoire reçu lors de
            la création de votre compte.
          </p>
          <form (ngSubmit)="submit()" class="mt-6 space-y-4">
            @if (!firstLogin()) {
              <div>
                <label class="label">Mot de passe actuel</label>
                <input class="input" type="password" autocomplete="current-password"
                       [(ngModel)]="current" name="current" placeholder="••••••••"
                       (blur)="touchCurrent()" (ngModelChange)="currentErr() && touchCurrent()">
                @if (currentErr()) { <p class="text-xs text-red-600 mt-1">{{ currentErr() }}</p> }
              </div>
            }
            <div>
              <label class="label">Nouveau mot de passe</label>
              <input class="input" type="password" autocomplete="new-password"
                     [(ngModel)]="next" name="next" placeholder="8 caractères minimum"
                     (blur)="touchNext()" (ngModelChange)="nextErr() && touchNext(); confirmErr() && touchConfirm()">
              @if (nextErr()) { <p class="text-xs text-red-600 mt-1">{{ nextErr() }}</p> }
            </div>
            <div>
              <label class="label">Confirmer le nouveau mot de passe</label>
              <input class="input" type="password" autocomplete="new-password"
                     [(ngModel)]="confirm" name="confirm" placeholder="••••••••"
                     (blur)="touchConfirm()" (ngModelChange)="confirmErr() && touchConfirm()">
              @if (confirmErr()) { <p class="text-xs text-red-600 mt-1">{{ confirmErr() }}</p> }
            </div>
            @if (errorMsg()) { <p class="text-xs text-red-600">{{ errorMsg() }}</p> }
            <button type="submit" class="btn btn-primary w-full" [disabled]="loading()">
              {{ loading() ? 'Enregistrement…' : 'Enregistrer' }}
            </button>
          </form>
        </div>
      </div>
    </div>
  `
})
export class ChangePasswordPage {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly data = inject(MockData);
  current = '';
  next = '';
  confirm = '';
  currentErr = signal('');
  nextErr = signal('');
  confirmErr = signal('');
  errorMsg = signal('');
  loading = signal(false);

  firstLogin(): boolean {
    return this.data.currentUser().mustChangePassword === true;
  }

  touchCurrent() {
    this.currentErr.set(!this.current ? 'Saisissez votre mot de passe actuel.' : '');
  }
  touchNext() {
    this.nextErr.set(!this.next ? 'Saisissez le nouveau mot de passe.' :
                     this.next.length < 8 ? '8 caractères minimum.' :
                     (!this.firstLogin() && this.next === this.current) ? 'Doit être différent du mot de passe actuel.' : '');
  }
  touchConfirm() {
    this.confirmErr.set(!this.confirm ? 'Confirmez le nouveau mot de passe.' :
                        this.confirm !== this.next ? 'Les mots de passe ne correspondent pas.' : '');
  }

  submit() {
    const first = this.firstLogin();
    if (!first) this.touchCurrent();
    this.touchNext();
    this.touchConfirm();
    if ((!first && this.currentErr()) || this.nextErr() || this.confirmErr()) return;
    this.errorMsg.set('');
    if (this.loading()) return;
    this.loading.set(true);
    this.auth.changePassword(first ? undefined : this.current, this.next)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: () => {
          this.router.navigate(['/auth/login'], { queryParams: { changed: 1 } });
        },
        error: (err) => { this.errorMsg.set(this.auth.errorMessage(err)); },
      });
  }
}

@Component({
  selector: 'afb-register',
  imports: [RouterLink, FormsModule, SignatureField, FaceScanComponent, ConventionReaderDialog,
            IdDocumentUpload, MasqueDirective],
  template: `
    <div class="w-full max-w-md">
      <div class="card">
        <div class="p-6 sm:p-8">
          <h1 class="text-xl sm:text-2xl font-bold text-gray-900">Ouvrir un compte-titres</h1>
          <p class="text-sm text-gray-500 mt-1">Renseignez vos informations pour créer votre espace investisseur Afriland First Bond.</p>
            <a routerLink="/auth/guide"
              class="mt-4 flex items-center justify-between gap-2 rounded-lg border border-afb-red/30 bg-red-50 px-3 py-2.5 no-underline hover:bg-red-100 transition-colors">
              <span class="text-xs text-gray-700">
                <b class="text-afb-red">Besoin d'aide ?</b> Suivez le guide étape par étape.
              </span>
              <span class="text-xs text-afb-red font-semibold whitespace-nowrap">Voir le guide →</span>
            </a>
                    <form (ngSubmit)="submit()" class="mt-6 space-y-4">
            <!-- Qualité du souscripteur : conditionne la nature du dossier (Annexe 1). -->
            <div>
              <label class="label">Vous êtes</label>
              <div class="grid grid-cols-2 gap-2">
                <label class="flex items-center gap-2 rounded-lg border p-3 cursor-pointer text-sm"
                       [class.border-afb-red]="form.typePersonne === 'PP'"
                       [class.bg-red-50]="form.typePersonne === 'PP'">
                  <input type="radio" name="typePersonne" value="PP" [(ngModel)]="form.typePersonne" required>
                  <span><b>Personne physique</b><br><span class="text-[11px] text-gray-500">Un particulier</span></span>
                </label>
                <label class="flex items-center gap-2 rounded-lg border p-3 cursor-pointer text-sm"
                       [class.border-afb-red]="form.typePersonne === 'PM'"
                       [class.bg-red-50]="form.typePersonne === 'PM'">
                  <input type="radio" name="typePersonne" value="PM" [(ngModel)]="form.typePersonne" required>
                  <span><b>Personne morale</b><br><span class="text-[11px] text-gray-500">Société, association</span></span>
                </label>
              </div>
            </div>

            <!-- Type de compte : un compte JOINT soumet chaque ordre à la validation
                 (signature + visage) de tous les autres titulaires. -->
            <div>
              <label class="label">Type de compte-titres</label>
              <div class="grid grid-cols-2 gap-2">
                <label class="flex items-center gap-2 rounded-lg border p-3 cursor-pointer text-sm"
                       [class.border-afb-red]="form.typeCompte === 'INDIVIDUEL'"
                       [class.bg-red-50]="form.typeCompte === 'INDIVIDUEL'">
                  <input type="radio" name="typeCompte" value="INDIVIDUEL" [(ngModel)]="form.typeCompte" required>
                  <span><b>Compte titres</b><br><span class="text-[11px] text-gray-500">Un seul titulaire</span></span>
                </label>
                <label class="flex items-center gap-2 rounded-lg border p-3 cursor-pointer text-sm"
                       [class.border-afb-red]="form.typeCompte === 'JOINT'"
                       [class.bg-red-50]="form.typeCompte === 'JOINT'">
                  <input type="radio" name="typeCompte" value="JOINT" [(ngModel)]="form.typeCompte" required>
                  <span><b>Compte joint</b><br><span class="text-[11px] text-gray-500">Plusieurs titulaires</span></span>
                </label>
              </div>
              @if (form.typeCompte === 'JOINT') {
                <p class="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mt-2 leading-relaxed">
                  ⚠️ Compte joint : chaque ordre passé devra être validé par <b>tous</b> les autres
                  titulaires, qui signeront et présenteront leur visage. Les co-titulaires sont
                  rattachés par le back-office après vérification de votre dossier.
                </p>
              }
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="label">{{ form.typePersonne === 'PM' ? 'Raison sociale' : 'Nom' }}</label>
                <input class="input" [(ngModel)]="form.nom" name="nom" required
                       [placeholder]="form.typePersonne === 'PM' ? 'DÉNOMINATION SOCIALE' : 'NOM'">
              </div>
              @if (form.typePersonne !== 'PM') {
                <div><label class="label">Prénom</label><input class="input" [(ngModel)]="form.prenom" name="prenom" placeholder="Jean Paul"></div>
              } @else {
                <div><label class="label">Représentant légal</label><input class="input" [(ngModel)]="form.prenom" name="prenom" placeholder="Nom du dirigeant"></div>
              }
            </div>
            <div><label class="label">E-mail</label><input class="input" type="email" [(ngModel)]="form.email" name="email" required placeholder="vous@exemple.cm"></div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><label class="label">Mot de passe</label><input class="input" type="password" [(ngModel)]="form.password" name="pwd" required placeholder="8 caractères min."></div>
              <div><label class="label">Confirmation</label><input class="input" type="password" [(ngModel)]="form.password2" name="pwd2" required placeholder="Répétez le mot de passe"></div>
            </div>
            @if (form.password && form.password2 && form.password !== form.password2) {
              <p class="text-xs text-afb-red">Les mots de passe ne correspondent pas.</p>
            }
            <div>
              <label class="label">Téléphone <span class="text-xs text-gray-400 font-normal">(+237 puis 9 chiffres)</span></label>
              <input class="input font-mono tracking-wide" afbMasque="telephone"
                     [(ngModel)]="form.telephone" name="tel" inputmode="numeric"
                     placeholder="+237 6XX XX XX XX">
            </div>
            <div>
              <label class="label">Numéro de compte espèces <span class="text-xs text-gray-400 font-normal">(23 chiffres)</span></label>
              <input class="input font-mono tracking-wide" afbMasque="compte"
                     [(ngModel)]="form.compte" name="cpt" required inputmode="numeric"
                     placeholder="10005 00090 56010090000 48">
            </div>

            <!-- Vérification faciale (contrôle de vivacité) -->
            <div class="pt-1">
              <label class="label">Vérification faciale</label>
              @if (faceResult()) {
                <div class="flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-700">
                  <span class="text-lg">✓</span> Visage vérifié.
                  <button type="button" class="ml-auto text-xs text-emerald-700 underline" (click)="reprendreFace()">Reprendre</button>
                </div>
              } @else if (scanActif()) {
                <div class="rounded-lg border border-gray-200 p-3">
                  <afb-face-scan (captured)="onFace($event)" />
                </div>
              } @else {
                <button type="button" class="btn btn-outline w-full" (click)="scanActif.set(true)">📷 Activer la caméra pour la vérification</button>
                <p class="text-[11px] text-gray-400 mt-1">Une capture de votre visage est requise (contrôle de présence réelle).</p>
              }
            </div>

            <div class="pt-1">
              <label class="label">Spécimen de signature <span class="text-xs text-gray-400 font-normal">(optionnel)</span></label>
              <afb-signature-field
                [(signatureData)]="form.signatureData"
                [height]="120"
                label="Cliquez pour apposer votre signature"
                hint="Souris, doigt ou stylet"
                dialogTitle="Spécimen de signature"
                dialogMessage="Signez dans le cadre ci-dessous." />
            </div>
            <!-- Pièce d'identité : refusée si floue, illisible, ou si ce n'est pas une pièce -->
            <div class="pt-1">
              <label class="label">Pièce d'identité</label>
              <afb-id-document-upload (pieces)="onPieces($event)" />
            </div>

            <!-- Convention de compte-titres : lecture obligatoire avant acceptation -->
            <div class="pt-1">
              <label class="label">Convention de compte-titres</label>
              @if (conventionLue()) {
                <div class="flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-700">
                  <span class="text-lg">✓</span> Convention lue et acceptée.
                  <button type="button" class="ml-auto text-xs text-emerald-700 underline" (click)="conventionOpen.set(true)">Relire</button>
                </div>
              } @else {
                <button type="button" class="btn btn-outline w-full" (click)="conventionOpen.set(true)">📄 Lire la convention</button>
                <p class="text-[11px] text-gray-400 mt-1">Lecture intégrale obligatoire (défilement jusqu'en bas) avant de pouvoir accepter.</p>
              }
            </div>

            <label class="flex items-start gap-2 text-xs text-gray-600 pt-2"
                   [class.opacity-50]="!conventionLue()">
              <input type="checkbox" class="mt-0.5" [(ngModel)]="form.accepte" name="accepte" required [disabled]="!conventionLue()">
              <span>J'accepte la convention de compte-titres et la politique de confidentialité Afriland First Bank.</span>
            </label>
            <!-- Le bouton reste desactive tant que le dossier est incomplet : on dit
                 explicitement CE QUI MANQUE, sinon le clic semble « ne rien faire ». -->
            @if (manquants().length) {
              <div class="rounded-lg bg-amber-50 border border-amber-200 p-3">
                <p class="text-xs font-semibold text-amber-800">Pour créer votre compte, il reste à :</p>
                <ul class="mt-1 space-y-0.5">
                  @for (m of manquants(); track m) {
                    <li class="text-xs text-amber-700">• {{ m }}</li>
                  }
                </ul>
              </div>
            }
            <button type="submit" class="btn btn-primary w-full" [disabled]="!canSubmit() || loading()">
              {{ loading() ? 'Création…' : 'Créer mon compte' }}
            </button>
          </form>
          <div class="mt-5 pt-5 border-t border-gray-100 text-center text-sm text-gray-500">
            Déjà un compte ? <a routerLink="/auth/login" class="text-afb-red font-medium">Se connecter</a>
          </div>

          <afb-convention-reader [open]="conventionOpen()"
            (confirm)="onConventionLue()" (cancel)="conventionOpen.set(false)" />
        </div>
      </div>
      <p class="text-[11px] text-gray-400 text-center mt-4">Vos données sont chiffrées (TLS 1.2 · AES-256). MFA activé par défaut.</p>
    </div>
  `
})
export class RegisterPPPage {
  private readonly router = inject(Router);
  private readonly reg = inject(RegistrationService);
  private readonly toast = inject(ToastService);

  form: any = { typePersonne: 'PP', typeCompte: 'INDIVIDUEL',
                nom: '', prenom: '', email: '', password: '', password2: '',
                telephone: '', compte: '', signatureData: '', accepte: false };

  readonly scanActif = signal(false);
  readonly faceResult = signal<FaceCaptureResult | null>(null);
  readonly loading = signal(false);
  readonly conventionOpen = signal(false);
  readonly conventionLue = signal(false);
  /** Pièces d'identité validées (recto/verso) — au moins une exigée. */
  readonly pieces = signal<PieceIdentite[]>([]);

  onFace(result: FaceCaptureResult) {
    this.faceResult.set(result);
    this.scanActif.set(false);
  }

  onPieces(pieces: PieceIdentite[]) {
    this.pieces.set(pieces);
  }

  /** Appelé quand l'utilisateur a lu la convention jusqu'au bout et l'accepte. */
  onConventionLue() {
    this.conventionLue.set(true);
    this.form.accepte = true;
    this.conventionOpen.set(false);
  }

  reprendreFace() {
    this.faceResult.set(null);
    this.scanActif.set(true);
  }

  /** Chiffres du compte espèces, espaces retirés (c'est cette forme qui part en base). */
  private compteDigits(): string {
    return chiffres(this.form.compte ?? '');
  }

  /**
   * Ce qu'il reste à faire pour pouvoir soumettre. Source unique de vérité :
   * `canSubmit()` en découle, donc le bouton ne peut jamais être désactivé sans
   * qu'on en affiche la raison.
   */
  manquants(): string[] {
    const f = this.form;
    const m: string[] = [];
    if (!f.nom?.trim()) m.push('Renseigner votre nom');
    if (!isValidEmail(f.email)) m.push('Renseigner un e-mail valide');
    if (!f.password || f.password.length < 8) m.push('Choisir un mot de passe (8 caractères minimum)');
    else if (f.password !== f.password2) m.push('Confirmer le mot de passe (les deux saisies diffèrent)');
    if (!compteComplet(this.form.compte ?? '')) {
      m.push(`Compléter le compte espèces (23 chiffres — ${this.compteDigits().length} pour l'instant)`);
    }
    if (!this.faceResult()) m.push('Effectuer la vérification faciale (activer la caméra)');
    if (!this.pieces().length) m.push("Téléverser votre pièce d'identité");
    if (!this.conventionLue()) m.push('Lire la convention jusqu’au bout');
    else if (!f.accepte) m.push('Cocher « J’accepte la convention »');
    return m;
  }

  canSubmit(): boolean {
    return this.manquants().length === 0;
  }

  /**
   * Dossier deja cree lors d'une tentative precedente.
   *
   * <p>Le compte est cree AVANT l'envoi du visage et de la piece. Si l'un de ces
   * envois echoue, le compte existe deja : re-cliquer relancait `register` et
   * butait sur « un compte existe deja pour cet e-mail », enfermant
   * l'utilisateur. On memorise donc le dossier pour <b>reprendre</b> a l'etape
   * qui a echoue au lieu de tout recommencer.</p>
   */
  private readonly dossierEnCours = signal<string | null>(null);

  submit() {
    if (!this.canSubmit() || this.loading()) return;
    this.loading.set(true);

    // Reprise : le compte a deja ete cree, on renvoie seulement ce qui manque.
    const dejaCree = this.dossierEnCours();
    if (dejaCree) {
      this.envoyerVisagePuisPieces(dejaCree);
      return;
    }

    const f = this.form;
    this.reg.register({
      email: f.email.trim(), password: f.password, nom: f.nom.trim(),
      prenom: f.prenom?.trim() || undefined,
      // Téléphone envoyé au format international compact (« +2376XXXXXXXX »).
      telephone: telephoneInternational(f.telephone ?? '') || undefined,
      typePersonne: this.form.typePersonne === 'PM' ? 'PM' : 'PP',
      typeCompte: this.form.typeCompte === 'JOINT' ? 'JOINT' : 'INDIVIDUEL',
      compteEspeces: this.compteDigits(),
    }).subscribe({
      next: (r) => {
        this.reg.setToken(r.auth.accessToken);
        this.dossierEnCours.set(r.dossierId);   // permet la reprise en cas d'echec
        this.envoyerVisagePuisPieces(r.dossierId);
      },
      error: (e) => { this.toast.error(this.messageErreur(e)); this.loading.set(false); },
    });
  }

  /** Envoie la capture faciale puis les pièces. Un échec laisse le dossier reprenable. */
  private envoyerVisagePuisPieces(dossierId: string) {
    const face = this.faceResult();
    if (!face) {
      this.envoyerPieces(dossierId);
      return;
    }
    this.reg.uploadFace(dossierId, face).subscribe({
      next: () => this.envoyerPieces(dossierId),
      error: () => this.echecEnvoi('la capture faciale'),
    });
  }

  /** Dépose les pièces d'identité validées, puis soumet le dossier. */
  private envoyerPieces(dossierId: string) {
    const pieces = this.pieces();
    if (!pieces.length) {
      this.soumettre(dossierId);
      return;
    }
    forkJoin(pieces.map(p => this.reg.uploadPiece(dossierId, p))).subscribe({
      next: () => this.soumettre(dossierId),
      error: () => this.echecEnvoi('la pièce d’identité'),
    });
  }

  /**
   * Soumet le dossier au back-office — l'étape sans laquelle rien n'arrive.
   *
   * Tant qu'un dossier reste en brouillon, aucun agent ne le voit : il n'est
   * jamais examiné, donc jamais validé. C'est ici que la demande entre
   * réellement dans la file de vérification de la banque.
   */
  private soumettre(dossierId: string) {
    this.reg.submit(dossierId).subscribe({
      next: () => this.termine(),
      error: () => this.echecEnvoi('votre demande'),
    });
  }

  /** Échec d'un envoi : le compte EXISTE déjà, on invite à réessayer (sans le recréer). */
  private echecEnvoi(quoi: string) {
    this.toast.error(
      `Échec de l’envoi de ${quoi}`,
      'Votre compte a bien été créé. Cliquez à nouveau pour renvoyer — inutile de recommencer.');
    this.loading.set(false);
  }

  /**
   * Dossier entièrement enregistré : on renvoie **aussitôt** vers la connexion.
   *
   * La redirection ne doit dépendre de rien d'autre que de l'écriture en base.
   * Le message de confirmation est affiché après la navigation : s'il échouait,
   * le prospect resterait sinon bloqué sur un formulaire déjà soumis, tenté de
   * tout recommencer.
   */
  private termine() {
    this.dossierEnCours.set(null);
    this.reg.clearToken();
    this.loading.set(false);
    this.router.navigate(['/auth/login']);
    this.toast.success('Demande envoyée',
      'Votre demande d’ouverture est en cours de vérification par la banque.');
  }

  private messageErreur(e: any): string {
    if (e?.status === 409) return 'Un compte existe déjà pour cet e-mail.';
    if (e?.status === 400) return 'Informations invalides. Vérifiez votre saisie.';
    if (e?.status === 429) return 'Trop de tentatives. Réessayez dans quelques minutes.';
    return 'Une erreur est survenue. Réessayez.';
  }
}

/** Ancien formulaire détaillé (KYC officiel). Conservé pour le back-office mais non utilisé en inscription. */
@Component({
  selector: 'afb-register-legacy',
  imports: [RouterLink, FormsModule, SignatureField],
  template: `
    <div class="w-full max-w-5xl">
      <div class="text-center mb-4">
        <h1 class="text-xl font-bold underline">Annexe 1 : Formulaire d'ouverture de compte de titres financiers</h1>
        <p class="text-xs text-gray-500 mt-1">Afriland First Bond · À compléter en ligne · Conforme au formulaire officiel</p>
      </div>

      <form (ngSubmit)="submit()" #f="ngForm">
      <div class="card">
        <div class="p-5 border-b bg-gray-50">
          <label class="label">Numéro compte espèce à associer au compte titre</label>
          <input class="input font-mono tracking-widest" [(ngModel)]="form.compteEspeces" name="compteEspeces" maxlength="25" placeholder="0 3 7 · 1 0 0 0 1 · 1 2 3 4 5 6 7 8 9 0 1" required>
          <p class="hint">⚠️ IMPORTANT : En cas de pluralité de titulaires (compte joint, compte en indivision, compte usufruit / nue-propriété), joindre un exemplaire par co-titulaire accompagné des pièces justificatives.</p>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 divide-x">
          <div class="p-5">
            <div class="bg-gray-100 -mx-5 -mt-5 px-5 py-2 mb-4 text-sm font-bold text-center">TITULAIRE PERSONNE PHYSIQUE</div>
            <div class="space-y-3 text-sm">
              <div>
                <label class="label">Civilité : Madame, Mademoiselle, Monsieur</label>
                <div class="flex gap-4 mt-1">
                  <label class="flex items-center gap-1"><input type="radio" name="civilitePP" [(ngModel)]="form.civilite" value="Madame"> Madame</label>
                  <label class="flex items-center gap-1"><input type="radio" name="civilitePP" [(ngModel)]="form.civilite" value="Mademoiselle"> Mademoiselle</label>
                  <label class="flex items-center gap-1"><input type="radio" name="civilitePP" [(ngModel)]="form.civilite" value="Monsieur"> Monsieur</label>
                </div>
              </div>
              <div><label class="label">Nom :</label><input class="input" [(ngModel)]="form.nom" name="nom"></div>
              <div><label class="label">Nom de jeune fille <span class="italic text-gray-400">(pour les femmes mariées)</span> :</label><input class="input" [(ngModel)]="form.nomJeuneFille" name="nomJeuneFille"></div>
              <div><label class="label">Prénom(s) :</label><input class="input" [(ngModel)]="form.prenom" name="prenom"></div>
              <div><label class="label">Date de naissance :</label><input class="input" type="date" [(ngModel)]="form.dateNaissance" name="dateNaissance"></div>
              <div><label class="label">Lieu de naissance :</label><input class="input" [(ngModel)]="form.lieuNaissance" name="lieuNaissance"></div>
              <div><label class="label">Pays de naissance :</label><input class="input" [(ngModel)]="form.paysNaissance" name="paysNaissance"></div>
              <div><label class="label">Nationalité :</label><input class="input" [(ngModel)]="form.nationalite" name="nationalite"></div>
            </div>
          </div>

          <div class="p-5">
            <div class="bg-gray-100 -mx-5 -mt-5 px-5 py-2 mb-4 text-sm font-bold text-center">TITULAIRE PERSONNE MORALE</div>
            <div class="space-y-3 text-sm">
              <div><label class="label">Nom de la société :</label><input class="input" [(ngModel)]="form.pmNom" name="pmNom"></div>
              <div><label class="label">N° Contribuable :</label><input class="input" [(ngModel)]="form.pmContribuable" name="pmContribuable"></div>
              <div><label class="label">RCCM N° :</label><input class="input" [(ngModel)]="form.pmRccm" name="pmRccm"></div>
              <div class="border-t pt-2"><b class="text-xs underline">Représentant légal 1 :</b></div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input class="input" placeholder="Nom" [(ngModel)]="form.pmRep1Nom" name="pmRep1Nom">
                <input class="input" placeholder="Prénom" [(ngModel)]="form.pmRep1Prenom" name="pmRep1Prenom">
                <input class="input" type="date" placeholder="Date de naissance" [(ngModel)]="form.pmRep1DateN" name="pmRep1DateN">
                <input class="input" placeholder="Nationalité" [(ngModel)]="form.pmRep1Nat" name="pmRep1Nat">
                <input class="input col-span-2" placeholder="Fonction" [(ngModel)]="form.pmRep1Fct" name="pmRep1Fct">
              </div>
              <div class="border-t pt-2"><b class="text-xs underline">Représentant légal 2 :</b></div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input class="input" placeholder="Nom" [(ngModel)]="form.pmRep2Nom" name="pmRep2Nom">
                <input class="input" placeholder="Prénom" [(ngModel)]="form.pmRep2Prenom" name="pmRep2Prenom">
                <input class="input" type="date" [(ngModel)]="form.pmRep2DateN" name="pmRep2DateN">
                <input class="input" placeholder="Nationalité" [(ngModel)]="form.pmRep2Nat" name="pmRep2Nat">
                <input class="input col-span-2" placeholder="Fonction" [(ngModel)]="form.pmRep2Fct" name="pmRep2Fct">
              </div>
            </div>
          </div>
        </div>

        <div>
          <div class="bg-gray-100 px-5 py-2 text-sm font-bold text-center border-y">ADRESSE FISCALE DU TITULAIRE</div>
          <div class="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
            <div class="col-span-4"><label class="label">Résidence, Bâtiment :</label><input class="input" [(ngModel)]="form.adrResidence" name="adrResidence"></div>
            <div class="col-span-2"><label class="label">N°, Rue :</label><input class="input" [(ngModel)]="form.adrRue" name="adrRue"></div>
            <div><label class="label">Code postal :</label><input class="input" [(ngModel)]="form.adrCp" name="adrCp"></div>
            <div><label class="label">Ville :</label><input class="input" [(ngModel)]="form.adrVille" name="adrVille"></div>
            <div class="col-span-4"><label class="label">Pays :</label><input class="input" [(ngModel)]="form.adrPays" name="adrPays"></div>
          </div>

          <div class="bg-gray-100 px-5 py-2 text-sm font-bold text-center border-y">ADRESSE <u>POSTALE</u> DU TITULAIRE (si différente de l'adresse fiscale)</div>
          <div class="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
            <div class="col-span-4"><label class="label">Résidence, Bâtiment :</label><input class="input" [(ngModel)]="form.postResidence" name="postResidence"></div>
            <div class="col-span-2"><label class="label">N°, Rue :</label><input class="input" [(ngModel)]="form.postRue" name="postRue"></div>
            <div><label class="label">Code postal :</label><input class="input" [(ngModel)]="form.postCp" name="postCp"></div>
            <div><label class="label">Ville :</label><input class="input" [(ngModel)]="form.postVille" name="postVille"></div>
            <div class="col-span-4"><label class="label">Pays :</label><input class="input" [(ngModel)]="form.postPays" name="postPays"></div>
          </div>

          <div class="bg-gray-100 px-5 py-2 text-sm font-bold text-center border-y">COORDONNÉES DU TITULAIRE</div>
          <div class="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div><label class="label">Tél Portable :</label><input class="input" [(ngModel)]="form.telPort" name="telPort"></div>
            <div><label class="label">Tél Domicile :</label><input class="input" [(ngModel)]="form.telDom" name="telDom"></div>
            <div class="col-span-2"><label class="label">Email :</label><input class="input font-mono" type="email" [(ngModel)]="form.email" name="email"></div>
          </div>

          <div class="bg-gray-100 px-5 py-2 text-sm font-bold text-center border-y">RESTRICTIONS ÉVENTUELLES <span class="italic text-gray-600 font-normal">(cocher les cases correspondantes)</span></div>
          <div class="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <b class="block mb-2">Mineur :</b>
              <label class="flex items-center gap-2"><input type="checkbox" [(ngModel)]="form.minAdmLegale" name="minAdmLegale"> Administration légale</label>
              <label class="flex items-center gap-2"><input type="checkbox" [(ngModel)]="form.minTutelle" name="minTutelle"> Tutelle</label>
            </div>
            <div>
              <b class="block mb-2">Majeur protégé :</b>
              <label class="flex items-center gap-2"><input type="checkbox" [(ngModel)]="form.majSauvegarde" name="majSauvegarde"> Sauvegarde de justice</label>
              <label class="flex items-center gap-2"><input type="checkbox" [(ngModel)]="form.majHabFamiliale" name="majHabFamiliale"> Habilitation familiale</label>
              <label class="flex items-center gap-2"><input type="checkbox" [(ngModel)]="form.majCuratelle" name="majCuratelle"> Curatelle</label>
              <label class="flex items-center gap-2"><input type="checkbox" [(ngModel)]="form.majTutelle" name="majTutelle"> Tutelle</label>
            </div>
            <div class="col-span-2 border-t pt-3">
              <b class="block mb-2">Coordonnées du (des) représentant(s) du mineur ou du majeur protégé</b>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div class="border rounded p-3">
                  <b class="text-xs">Représentant A :</b>
                  <input class="input mt-1" placeholder="Nom" [(ngModel)]="form.repANom" name="repANom">
                  <input class="input mt-1" placeholder="Prénom" [(ngModel)]="form.repAPrenom" name="repAPrenom">
                  <input class="input mt-1" type="date" [(ngModel)]="form.repADateN" name="repADateN">
                  <input class="input mt-1" placeholder="Nationalité" [(ngModel)]="form.repANat" name="repANat">
                  <input class="input mt-1" placeholder="N°, Rue" [(ngModel)]="form.repARue" name="repARue">
                  <input class="input mt-1" placeholder="Code postal · Ville · Pays" [(ngModel)]="form.repACp" name="repACp">
                </div>
                <div class="border rounded p-3">
                  <b class="text-xs">Représentant B :</b>
                  <input class="input mt-1" placeholder="Nom" [(ngModel)]="form.repBNom" name="repBNom">
                  <input class="input mt-1" placeholder="Prénom" [(ngModel)]="form.repBPrenom" name="repBPrenom">
                  <input class="input mt-1" type="date" [(ngModel)]="form.repBDateN" name="repBDateN">
                  <input class="input mt-1" placeholder="Nationalité" [(ngModel)]="form.repBNat" name="repBNat">
                  <input class="input mt-1" placeholder="N°, Rue" [(ngModel)]="form.repBRue" name="repBRue">
                  <input class="input mt-1" placeholder="Code postal · Ville · Pays" [(ngModel)]="form.repBCp" name="repBCp">
                </div>
              </div>
            </div>
          </div>

          <div class="bg-gray-100 px-5 py-2 text-sm font-bold text-center border-y">CARACTÉRISTIQUES DU COMPTE <span class="italic text-gray-600 font-normal">(cocher la case correspondante)</span></div>
          <div class="p-5 space-y-4 text-sm">
            <label class="flex items-center gap-2"><input type="radio" name="typeCompte" value="INDIVIDUEL" [(ngModel)]="form.typeCompte"> <b>Compte individuel pleine propriété (cas général)</b></label>

            <div class="border-l-2 border-gray-300 pl-4">
              <label class="flex items-center gap-2"><input type="radio" name="typeCompte" value="JOINT" [(ngModel)]="form.typeCompte"> <b>Compte joint de Titres</b></label>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                <div><u>Titulaire A</u> - Nom : <input class="input" [(ngModel)]="form.jtANom" name="jtANom"></div>
                <div>Prénom : <input class="input" [(ngModel)]="form.jtAPrenom" name="jtAPrenom"></div>
                <div><u>Titulaire B</u> - Nom : <input class="input" [(ngModel)]="form.jtBNom" name="jtBNom"></div>
                <div>Prénom : <input class="input" [(ngModel)]="form.jtBPrenom" name="jtBPrenom"></div>
              </div>
            </div>

            <div class="border-l-2 border-gray-300 pl-4">
              <label class="flex items-center gap-2"><input type="radio" name="typeCompte" value="INDIVIS" [(ngModel)]="form.typeCompte"> <b>Compte en indivision entre :</b></label>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                @for (i of ['A','B','C','D']; track i) {
                  <div class="col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div><u>Titulaire {{i}}</u> - Nom : <input class="input"></div>
                    <div>Prénom : <input class="input"></div>
                  </div>
                }
              </div>
            </div>

            <div class="border-l-2 border-gray-300 pl-4">
              <label class="flex items-center gap-2"><input type="radio" name="typeCompte" value="DEMEMBRE" [(ngModel)]="form.typeCompte"> <b>Compte démembré (usufruit / nue-propriété) :</b></label>
              <div class="mt-2 space-y-2">
                <div><u>Titulaire A en tant que représentant de la nue-propriété</u> : <div class="grid grid-cols-1 sm:grid-cols-2 gap-2"><input class="input" placeholder="Nom"><input class="input" placeholder="Prénom"></div></div>
                <div><u>Titulaire B en tant que représentant de l'usufruit</u> : <div class="grid grid-cols-1 sm:grid-cols-2 gap-2"><input class="input" placeholder="Nom"><input class="input" placeholder="Prénom"></div></div>
                <div><u>Titulaire C</u> : <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2"><input class="input" placeholder="Nom"><input class="input" placeholder="Prénom"><input class="input" placeholder="Qualité"></div></div>
                <div><u>Titulaire D</u> : <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2"><input class="input" placeholder="Nom"><input class="input" placeholder="Prénom"><input class="input" placeholder="Qualité"></div></div>
              </div>
            </div>
          </div>

          <div class="p-5 border-t bg-gray-50 text-sm space-y-3">
            <p class="italic text-gray-700">Par le présent, je déclare (nous déclarons) avoir pris connaissance et adhérer à l'intégralité des dispositions de la convention d'ouverture de compte laquelle se compose du présent formulaire, ainsi que des conditions générales.</p>
            <div class="flex gap-3 items-center">
              <span>Fait à :</span><input class="input max-w-xs" [(ngModel)]="form.faitA" name="faitA">
              <span>le</span><input class="input max-w-xs" type="date" [(ngModel)]="form.faitLe" name="faitLe">
              <span>en deux exemplaires originaux.</span>
            </div>
            <div class="pt-3 border-t">
              <h3 class="text-sm font-bold mb-1">Spécimen de signature du titulaire</h3>
              <p class="text-[11px] text-gray-500 mb-2">Signature du titulaire du compte et de son(ses) éventuel(s) représentant(s) légal(aux) précédée des nom, prénom et qualité. <span class="italic">(En cas de compte joint, indivis ou démembré, la signature de tous les co-titulaires est exigée.)</span></p>
              <afb-signature-field
                [(signatureData)]="form.signatureData"
                [height]="140"
                label="Cliquez pour apposer votre spécimen de signature"
                hint="Le pad s'ouvrira pour vous permettre de signer à la souris, au doigt ou au stylet."
                dialogTitle="Spécimen de signature du titulaire"
                dialogMessage="Signez dans le cadre — précédée de vos nom, prénom et qualité." />
            </div>
            <label class="flex items-start gap-2 pt-3">
              <input type="checkbox" class="mt-1" [(ngModel)]="form.accepte" name="accepte" required>
              <span class="text-xs">J'accepte la <b>Convention de compte-titres Afriland First Bank</b>, la politique de confidentialité, et je confirme l'exactitude des informations ci-dessus.</span>
            </label>
          </div>
        </div>

        <div class="p-5 border-t flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <a routerLink="/auth/login" class="btn btn-outline">Annuler</a>
          <div class="flex flex-col sm:flex-row gap-2">
            <button type="button" class="btn btn-outline">Enregistrer le brouillon</button>
            <button type="submit" class="btn btn-primary" [disabled]="!form.accepte || !form.signatureData">Valider et soumettre</button>
          </div>
        </div>
      </div>
      </form>

      <div class="text-center mt-4 text-sm text-gray-500">
        <a routerLink="/auth/register-pm" class="text-afb-red">Formulaire spécifique personne morale</a> ·
        <a routerLink="/auth/login" class="text-afb-red">J'ai déjà un compte</a>
      </div>
    </div>
  `
})
export class RegisterPPLegacyPage {
  private readonly router = inject(Router);
  form: any = {
    compteEspeces: '',
    civilite: 'Monsieur', nom: '', nomJeuneFille: '', prenom: '',
    dateNaissance: '', lieuNaissance: '', paysNaissance: 'Cameroun', nationalite: 'Camerounaise',
    adrResidence:'', adrRue:'', adrCp:'', adrVille:'Yaoundé', adrPays:'Cameroun',
    postResidence:'', postRue:'', postCp:'', postVille:'', postPays:'',
    telPort:'', telDom:'', email:'',
    typeCompte:'INDIVIDUEL',
    faitA:'Yaoundé', faitLe: new Date().toISOString().slice(0,10), accepte: false
  };
  submit() {
    if (!this.form.accepte) return;
    this.router.navigate(['/auth/mfa']);
  }
}

@Component({
  selector: 'afb-register-pm',
  imports: [RouterLink, FormsModule],
  template: `
    <div class="w-full max-w-3xl">
      <div class="card">
        <div class="card-header">
          <div>
            <h1 class="text-xl font-bold">Ouverture d'un compte-titres — Personne Morale</h1>
            <p class="text-sm text-gray-500">Validation par l'équipe Conformité après dépôt du dossier</p>
          </div>
        </div>
        <div class="card-body space-y-4">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div class="col-span-2"><label class="label">Dénomination sociale</label><input class="input"></div>
            <div><label class="label">N° RCCM</label><input class="input"></div>
            <div><label class="label">N° contribuable</label><input class="input"></div>
            <div><label class="label">Forme juridique</label><select class="select"><option>SA</option><option>SARL</option><option>SAS</option><option>GIE</option></select></div>
            <div><label class="label">Secteur d'activité</label><input class="input"></div>
          </div>
          <div class="pt-2">
            <div class="text-sm font-semibold text-gray-900 mb-2">Représentants légaux</div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input class="input" placeholder="Représentant 1 — Nom Prénom">
              <input class="input" placeholder="Fonction">
              <input class="input" placeholder="Représentant 2 — Nom Prénom">
              <input class="input" placeholder="Fonction">
            </div>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div class="border-2 border-dashed rounded-lg p-4 text-center text-sm"><div class="text-2xl">📄</div>Statuts de la société</div>
            <div class="border-2 border-dashed rounded-lg p-4 text-center text-sm"><div class="text-2xl">📄</div>Extrait RCCM &lt; 3 mois</div>
            <div class="border-2 border-dashed rounded-lg p-4 text-center text-sm"><div class="text-2xl">🪪</div>CNI des représentants</div>
            <div class="border-2 border-dashed rounded-lg p-4 text-center text-sm"><div class="text-2xl">🤝</div>Délégation de pouvoirs</div>
          </div>
          <div class="flex justify-end gap-2 pt-4 border-t">
            <a routerLink="/auth/login" class="btn btn-outline">Annuler</a>
            <button class="btn btn-primary">Déposer le dossier</button>
          </div>
        </div>
      </div>
    </div>
  `
})
export class RegisterPMPage {}

@Component({
  selector: 'afb-mfa',
  imports: [RouterLink, FormsModule],
  template: `
    <div class="w-full max-w-md">
      <div class="card p-6 sm:p-8">
        <div class="w-14 h-14 rounded-full bg-afb-red-light text-afb-red grid place-items-center text-2xl mx-auto">🔐</div>
        <h1 class="text-xl sm:text-2xl font-bold text-gray-900 mt-4 text-center">Authentification forte</h1>
        @if (phoneHint()) {
          <p class="text-sm text-gray-500 text-center mt-1">Saisissez le code OTP envoyé au <b>{{ phoneHint() }}</b></p>
        } @else {
          <p class="text-sm text-gray-500 text-center mt-1">Saisissez le code OTP qui vous a été envoyé.</p>
        }
        @if (!hasPending()) {
          <div class="mt-5 p-3 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-900">
            ⚠ Aucune connexion en cours. Merci de saisir d'abord vos identifiants.
          </div>
        }
        <div class="flex gap-1.5 sm:gap-2 justify-center mt-6" (paste)="onPaste($event)">
          @for (i of slots; track i; let idx = $index) {
            <input #slot
                   class="w-10 h-12 sm:w-12 sm:h-14 text-center text-lg sm:text-xl font-bold input p-0"
                   maxlength="1" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code"
                   [value]="digits[idx]"
                   [disabled]="!hasPending()"
                   (input)="onInput(idx, $event)"
                   (keydown)="onKey(idx, $event)"
                   (focus)="onFocus($event)">
          }
        </div>
        @if (errorMsg()) { <p class="text-xs text-red-600 text-center mt-2">{{ errorMsg() }}</p> }
        <p class="text-xs text-gray-500 text-center mt-3">Code à 6 chiffres · valable 5 minutes</p>
        <button class="btn btn-primary w-full mt-6" [disabled]="!complete() || !hasPending() || loading()" (click)="go()">{{ loading() ? 'Vérification…' : 'Valider' }}</button>
        <a routerLink="/auth/login" class="block text-center text-xs text-gray-400 mt-3" (click)="cancel()">← Retour</a>
      </div>
    </div>
  `
})
export class MfaPage {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  @ViewChildren('slot') slotsEl!: QueryList<ElementRef<HTMLInputElement>>;
  slots = [0,1,2,3,4,5];
  digits: string[] = ['','','','','',''];
  errorMsg = signal('');
  loading = signal(false);
  hasPending = () => !!this.auth.pendingChallenge();
  /** Numéro masqué où le code a été envoyé (vide si le compte n'a pas de téléphone). */
  phoneHint = () => this.auth.pendingChallenge()?.phoneHint ?? '';

  complete() { return this.digits.every(d => /\d/.test(d)); }

  onInput(idx: number, ev: Event) {
    const input = ev.target as HTMLInputElement;
    const v = input.value.replace(/\D/g,'').slice(0,1);
    this.digits[idx] = v;
    input.value = v;
    if (v && idx < 5) this.slotsEl.get(idx+1)?.nativeElement.focus();
    if (this.complete()) setTimeout(() => this.go(), 150);
  }
  onKey(idx: number, ev: KeyboardEvent) {
    if (ev.key === 'Backspace' && !this.digits[idx] && idx > 0) {
      this.slotsEl.get(idx-1)?.nativeElement.focus();
    }
    if (ev.key === 'ArrowLeft' && idx > 0) this.slotsEl.get(idx-1)?.nativeElement.focus();
    if (ev.key === 'ArrowRight' && idx < 5) this.slotsEl.get(idx+1)?.nativeElement.focus();
  }
  onFocus(ev: FocusEvent) { (ev.target as HTMLInputElement).select(); }
  onPaste(ev: ClipboardEvent) {
    const data = ev.clipboardData?.getData('text')?.replace(/\D/g,'').slice(0,6) ?? '';
    if (!data) return;
    ev.preventDefault();
    for (let i=0; i<6; i++) {
      this.digits[i] = data[i] ?? '';
      const el = this.slotsEl.get(i)?.nativeElement;
      if (el) el.value = this.digits[i];
    }
    this.slotsEl.get(Math.min(data.length,5))?.nativeElement.focus();
    if (this.complete()) setTimeout(() => this.go(), 150);
  }
  go() {
    if (!this.complete() || !this.hasPending() || this.loading()) return;
    this.errorMsg.set('');
    this.loading.set(true);
    const code = this.digits.join('');
    this.auth.verifyMfa(code).pipe(finalize(() => this.loading.set(false))).subscribe({
      next: (redirect) => this.router.navigateByUrl(redirect),
      error: (err) => {
        this.errorMsg.set(this.auth.errorMessage(err));
        this.digits = ['','','','','',''];
        this.slotsEl.forEach(ref => ref.nativeElement.value = '');
        this.slotsEl.get(0)?.nativeElement.focus();
      },
    });
  }
  cancel() { this.auth.cancelPending(); }
}

@Component({
  selector: 'afb-forgot',
  imports: [RouterLink, FormsModule],
  template: `
    <div class="w-full max-w-md">
      <div class="card p-8">
        <h1 class="text-2xl font-bold">Mot de passe oublié</h1>
        <p class="text-sm text-gray-500 mt-1">Un lien sécurisé à usage unique sera envoyé à votre adresse e-mail (valable 1h).</p>
        @if (sent()) {
          <div class="mt-5 rounded-lg bg-emerald-50 border border-emerald-200 p-4 text-sm text-emerald-800">
            Si un compte est associé à cette adresse, un e-mail de réinitialisation vient d'être envoyé.
            Vérifiez votre boîte de réception (et les indésirables).
          </div>
          <a routerLink="/auth/login" class="block text-center text-sm text-gray-500 mt-5">← Retour à la connexion</a>
        } @else {
          <form class="mt-5 space-y-4" (ngSubmit)="submit()">
            <div>
              <label class="label">Adresse e-mail</label>
              <input class="input" type="email" name="email" [(ngModel)]="email" autocomplete="email"
                     placeholder="vous@exemple.cm"
                     (blur)="touchEmail()" (ngModelChange)="emailErr() && touchEmail()">
              @if (emailErr()) { <p class="text-xs text-red-600 mt-1">{{ emailErr() }}</p> }
            </div>
            @if (errorMsg()) { <p class="text-sm text-afb-red">{{ errorMsg() }}</p> }
            <button class="btn btn-primary w-full" type="submit" [disabled]="loading()">
              {{ loading() ? 'Envoi…' : 'Envoyer le lien de réinitialisation' }}
            </button>
            <a routerLink="/auth/login" class="block text-center text-sm text-gray-500">← Retour à la connexion</a>
          </form>
        }
      </div>
    </div>
  `
})
export class ForgotPage {
  private readonly auth = inject(AuthService);
  email = '';
  emailErr = signal('');
  loading = signal(false);
  sent = signal(false);
  errorMsg = signal('');

  touchEmail() {
    this.emailErr.set(!this.email ? 'L\'e-mail est requis.' :
                      !isValidEmail(this.email) ? 'Format d\'e-mail invalide.' : '');
  }

  submit() {
    this.touchEmail();
    if (this.emailErr()) return;
    this.errorMsg.set('');
    this.loading.set(true);
    this.auth.forgotPassword(this.email)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: () => { this.sent.set(true); },
        error: () => { this.sent.set(true); },
      });
  }
}

@Component({
  selector: 'afb-reset-password',
  imports: [RouterLink, FormsModule],
  template: `
    <div class="w-full max-w-md">
      <div class="card p-8">
        <h1 class="text-2xl font-bold">Nouveau mot de passe</h1>
        <p class="text-sm text-gray-500 mt-1">Choisissez un nouveau mot de passe pour votre compte.</p>
        @if (done()) {
          <div class="mt-5 rounded-lg bg-emerald-50 border border-emerald-200 p-4 text-sm text-emerald-800">
            Votre mot de passe a été réinitialisé. Vous pouvez maintenant vous connecter.
          </div>
          <a routerLink="/auth/login" class="btn btn-primary w-full mt-5">Aller à la connexion</a>
        } @else if (!token) {
          <div class="mt-5 rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
            Lien de réinitialisation invalide ou incomplet. Refaites une demande depuis « Mot de passe oublié ».
          </div>
          <a routerLink="/auth/forgot" class="block text-center text-sm text-gray-500 mt-5">← Nouvelle demande</a>
        } @else {
          <form class="mt-5 space-y-4" (ngSubmit)="submit()">
            <div>
              <label class="label">Nouveau mot de passe</label>
              <input class="input" type="password" name="next" [(ngModel)]="next" autocomplete="new-password"
                     placeholder="8 caractères minimum"
                     (blur)="touchNext()" (ngModelChange)="nextErr() && touchNext(); confirmErr() && touchConfirm()">
              @if (nextErr()) { <p class="text-xs text-red-600 mt-1">{{ nextErr() }}</p> }
            </div>
            <div>
              <label class="label">Confirmer le mot de passe</label>
              <input class="input" type="password" name="confirm" [(ngModel)]="confirm" autocomplete="new-password"
                     placeholder="Ressaisissez le mot de passe"
                     (blur)="touchConfirm()" (ngModelChange)="confirmErr() && touchConfirm()">
              @if (confirmErr()) { <p class="text-xs text-red-600 mt-1">{{ confirmErr() }}</p> }
            </div>
            @if (errorMsg()) { <p class="text-sm text-afb-red">{{ errorMsg() }}</p> }
            <button class="btn btn-primary w-full" type="submit" [disabled]="loading()">
              {{ loading() ? 'Validation…' : 'Réinitialiser le mot de passe' }}
            </button>
            <a routerLink="/auth/login" class="block text-center text-sm text-gray-500">← Retour à la connexion</a>
          </form>
        }
      </div>
    </div>
  `
})
export class ResetPasswordPage {
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  token = this.route.snapshot.queryParamMap.get('token') ?? '';
  next = '';
  confirm = '';
  nextErr = signal('');
  confirmErr = signal('');
  loading = signal(false);
  done = signal(false);
  errorMsg = signal('');

  touchNext() {
    this.nextErr.set(!this.next ? 'Saisissez le nouveau mot de passe.' :
                     this.next.length < 8 ? '8 caractères minimum.' : '');
  }
  touchConfirm() {
    this.confirmErr.set(!this.confirm ? 'Confirmez le mot de passe.' :
                        this.confirm !== this.next ? 'Les mots de passe ne correspondent pas.' : '');
  }

  submit() {
    this.touchNext();
    this.touchConfirm();
    if (this.nextErr() || this.confirmErr()) return;
    this.errorMsg.set('');
    this.loading.set(true);
    this.auth.resetPassword(this.token, this.next)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: () => { this.done.set(true); },
        error: (err) => { this.errorMsg.set(this.auth.errorMessage(err)); },
      });
  }
}
