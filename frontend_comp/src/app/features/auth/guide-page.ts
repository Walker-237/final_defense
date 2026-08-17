import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RevealDirective } from '../../shared/reveal.directive';

/**
 * Page-guide statique « Comment ouvrir un compte-titres ».
 * Route cible : /auth/guide
 *
 * Choix de conception :
 *  - Les captures d'écran (public/tuto/) incluent DÉJÀ le cadre iPhone : on les
 *    affiche telles quelles, sans rajouter de cadre CSS (sinon double cadre).
 *  - Le cercle rouge dessiné à la main est superposé PAR-DESSUS le téléphone
 *    (z-index au-dessus), et s'élargit automatiquement pour les étapes à deux
 *    téléphones.
 *  - Les numéros d'étape (graphic_numN.png) sont tes visuels dessinés à la main.
 *  - Chaque bloc apparaît au défilement (directive afbReveal) : il glisse depuis
 *    le côté de son image.
 *  - Tout est piloté par le tableau `steps` : pour ajouter/retirer une étape,
 *    tu touches uniquement ce tableau, pas le HTML.
 */
interface GuideStep {
  num: number;
  numGraphic: string;
  title: string;
  body: string;
  shots: string[];
  imageSide: 'left' | 'right';
}

@Component({
  selector: 'afb-guide',
  standalone: true,
  imports: [RouterLink, RevealDirective],
  template: `
    <div class="guide-wrap">
      <header class="guide-header" afbReveal="up">
        <h1>Un souci pour créer votre compte ?</h1>
        <p class="guide-subtitle">Pas d'inquiétude — on vous guide, étape par étape.</p>
      </header>

      <div class="guide-steps">
        @for (step of steps; track step.num) {
          <section class="guide-step"
                   [class.img-left]="step.imageSide === 'left'"
                   [class.img-right]="step.imageSide === 'right'"
                   [afbReveal]="step.imageSide === 'right' ? 'right' : 'left'">

            <div class="step-visual">
              <!-- Cercle EN PREMIER dans le DOM mais AU-DESSUS via z-index -->
              <img src="/circle.png" alt="" aria-hidden="true"
                   class="hand-circle" [class.hand-circle-duo]="step.shots.length > 1">
              <!-- Captures : déjà encadrées (iPhone), affichées brutes -->
              <div class="phones" [class.phones-duo]="step.shots.length > 1">
                @for (shot of step.shots; track shot) {
                  <img [src]="shot" [alt]="step.title" class="phone-shot">
                }
              </div>
            </div>

            <div class="step-text">
              <div class="step-heading">
                <img [src]="step.numGraphic" alt="Étape {{ step.num }}" class="step-num">
                <h2>{{ step.title }}</h2>
              </div>
              <p>{{ step.body }}</p>
            </div>
          </section>
        }
      </div>

      <footer class="guide-footer" afbReveal="up">
        <p>Prêt à vous lancer ?</p>
        <a routerLink="/auth/register" class="btn btn-primary">J'ai compris, créer mon compte →</a>
        <a routerLink="/auth/login" class="guide-back">← Retour à la connexion</a>
      </footer>
    </div>
  `,
  styles: [`
    .guide-wrap { max-width: 960px; margin: 0 auto; padding: 40px 20px 80px; }

    /* En-tête */
    .guide-header { margin-bottom: 56px; }
    .guide-header h1 { font-size: 28px; font-weight: 800; color: #111827; margin: 0; }
    .guide-subtitle { font-size: 20px; font-weight: 700; color: #C8102E; margin: 6px 0 0; }

    /* Une étape = grille 2 colonnes (visuel | texte) */
    .guide-step {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 40px;
      align-items: center;
      margin-bottom: 96px;
    }
    /* Alternance gauche/droite */
    .guide-step.img-right .step-visual { order: 2; }
    .guide-step.img-right .step-text   { order: 1; }

    /* Colonne visuel */
    .step-visual {
      position: relative;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 420px;
    }

    /* Les captures incluent DÉJÀ le cadre iPhone : aucune bordure CSS ajoutée. */
    .phones {
      display: flex;
      gap: 12px;
      position: relative;
      z-index: 1;              /* sous le cercle */
    }
    .phone-shot {
      width: 210px;
      height: auto;
      display: block;
    }
    /* En duo : on rétrécit chaque téléphone pour tenir côte à côte */
    .phones-duo .phone-shot { width: 175px; }

    /* Cercle rouge à la main, PAR-DESSUS les téléphones */
    .hand-circle {
      position: absolute;
      z-index: 3;              /* au-dessus des téléphones */
      width: 500px;            /* un seul téléphone */
      pointer-events: none;
      opacity: .95;
    }
    /* Deux téléphones : cercle nettement plus large pour englober les deux */
    .hand-circle-duo { width: 1500px; }

    /* Colonne texte */
    .step-text { max-width: 380px; }
    .step-heading { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
    .step-num { height: 56px; width: auto; }
    .step-heading h2 { font-size: 20px; font-weight: 800; color: #111827; margin: 0; }
    .step-text p { font-size: 14px; line-height: 1.6; color: #4B5563; margin: 0; }

    /* CTA final */
    .guide-footer {
      text-align: center;
      border-top: 1px solid #E5E7EB;
      padding-top: 40px;
    }
    .guide-footer p { font-size: 16px; font-weight: 600; color: #111827; margin: 0 0 16px; }
    .guide-back { display: block; margin-top: 16px; font-size: 13px; color: #6B7280; }

    /* Mobile : empilement vertical, TEXTE au-dessus de son image */
    @media (max-width: 768px) {
      .guide-step {
        grid-template-columns: 1fr;
        gap: 16px;
        margin-bottom: 64px;
      }
      /* Le texte passe toujours avant le visuel, quel que soit img-left/img-right */
      .guide-step .step-text   { order: 1; }
      .guide-step .step-visual { order: 2; }
      .step-text { max-width: none; text-align: center; }
      .step-heading { justify-content: center; }
      .step-visual { min-height: 360px; }
      .phone-shot { width: 175px; }
      .phones-duo .phone-shot { width: 140px; }
      .hand-circle { width: 260px; }
      .hand-circle-duo { width: 400px; }
    }
  `]
})
export class GuidePage {
  readonly steps: GuideStep[] = [
    {
      num: 1,
      numGraphic: '/tuto/graphic_num1.png',
      title: 'Type de compte',
      body: "Choisissez votre profil (personne physique ou morale) et le type de compte-titres souhaité (individuel ou joint). Ce choix détermine la configuration du compte avant la saisie de vos informations personnelles.",
      shots: ['/tuto/guide1_account_type.png'],
      imageSide: 'right',
    },
    {
      num: 2,
      numGraphic: '/tuto/graphic_num2.png',
      title: 'Informations personnelles',
      body: "Cette section rassemble vos informations d'identification et de contact : nom, e-mail, téléphone, numéro de compte espèces et mot de passe. Ces champs sont nécessaires à la création de votre compte.",
      shots: ['/tuto/guide2_personal_info.png'],
      imageSide: 'left',
    },
    {
      num: 3,
      numGraphic: '/tuto/graphic_num3.png',
      title: "Vérification d'identité",
      body: "Pour respecter les obligations bancaires de connaissance client (KYC), vous effectuez une vérification faciale en direct, puis vous téléversez votre pièce d'identité (CNI, passeport ou carte de séjour) en cours de validité.",
      shots: ['/tuto/guide3a_face.png', '/tuto/guide3b_id_upload.png'],
      imageSide: 'right',
    },
    {
      num: 4,
      numGraphic: '/tuto/graphic_num4.png',
      title: 'Signature',
      body: "Vous pouvez apposer un spécimen de signature numérique. Cette étape est optionnelle mais pourra servir à la validation et à la vérification de vos futurs documents.",
      shots: ['/tuto/guide4_signature.png'],
      imageSide: 'left',
    },
    {
      num: 5,
      numGraphic: '/tuto/graphic_num5.png',
      title: 'Convention et confirmation',
      body: "Vous lisez la convention de compte-titres, acceptez les conditions et la politique de confidentialité, vérifiez les éventuelles actions restantes, puis soumettez votre demande d'ouverture de compte.",
      shots: ['/tuto/guide5a_review.png', '/tuto/guide5b_convention.png'],
      imageSide: 'right',
    },
  ];
}