import { RenderMode, ServerRoute } from '@angular/ssr';

/**
 * Stratégie de rendu serveur par route.
 *
 * Les pages AUTHENTIFIÉES (espace client et back-office) ainsi que les écrans
 * d'authentification sont rendus en mode CLIENT uniquement : la session n'existe
 * que dans le navigateur, donc le serveur ne peut pas connaître l'utilisateur.
 * Les pré-rendre / SSR afficherait l'état par défaut du service (aucun compte)
 * avant l'hydratation — ce qui provoquait un « flash » du compte d'une autre
 * personne au rechargement. En mode CLIENT, seule la coquille de l'app est
 * servie ; tout le contenu dépendant de l'utilisateur est rendu après la
 * restauration de session, avec les bonnes données et le bon espace (RBAC).
 *
 * Les pages PUBLIQUES (accueil, marché primaire) restent pré-rendues / SSR.
 */
export const serverRoutes: ServerRoute[] = [
  // Espaces authentifiés et écrans d'authentification : rendu navigateur seul.
  { path: 'client/**', renderMode: RenderMode.Client },
  { path: 'backoffice/**', renderMode: RenderMode.Client },
  { path: 'auth/**', renderMode: RenderMode.Client },

  // Détail public d'une émission (données dynamiques) : SSR par requête.
  { path: 'emissions/:id', renderMode: RenderMode.Server },

  // Reste (accueil public, liste des émissions) : pré-rendu statique.
  { path: '**', renderMode: RenderMode.Prerender },
];
