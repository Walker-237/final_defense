import { Routes } from '@angular/router';
import { authGuard, backofficeGuard, adminGuard, requirePermission, guestGuard } from './core/services/auth-guard';

/**
 * Routage avec chargement PARESSEUX (lazy) de chaque page : le bundle initial ne
 * contient plus que le strict nécessaire. Un client ne télécharge pas le code du
 * back-office (et inversement) — chargement initial nettement plus rapide.
 */

// Raccourcis de chargement paresseux (un chunk par fichier source).
const layouts = () => import('./core/layouts/layouts');
const auth = () => import('./features/auth/auth');
const guide = () => import('./features/auth/guide-page');
const client1 = () => import('./features/client/client-pages');
const client2 = () => import('./features/client/client-pages2');
const bo = () => import('./features/backoffice/backoffice-pages');

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'emissions' },

  // ──────────── Espace public (sans authentification) ────────────
  {
    path: '', loadComponent: () => layouts().then(m => m.PublicLayout), children: [
      { path: 'emissions', loadComponent: () => client1().then(m => m.EmissionsList) },
      { path: 'emissions/:id', loadComponent: () => client1().then(m => m.EmissionDetail) },
    ]
  },

  {
    path: 'auth', loadComponent: () => layouts().then(m => m.PublicLayout), children: [
      { path: 'login', loadComponent: () => auth().then(m => m.LoginPage), canActivate: [guestGuard] },
      { path: 'register', loadComponent: () => auth().then(m => m.RegisterPPPage), canActivate: [guestGuard] },
      { path: 'register-pm', loadComponent: () => auth().then(m => m.RegisterPMPage), canActivate: [guestGuard] },
      { path: 'guide', loadComponent: () => guide().then(m => m.GuidePage) },  
      { path: 'mfa', loadComponent: () => auth().then(m => m.MfaPage), canActivate: [guestGuard] },
      { path: 'forgot', loadComponent: () => auth().then(m => m.ForgotPage), canActivate: [guestGuard] },
      { path: 'reset', loadComponent: () => auth().then(m => m.ResetPasswordPage), canActivate: [guestGuard] },
      { path: 'change-password', loadComponent: () => auth().then(m => m.ChangePasswordPage), canActivate: [authGuard] },
      { path: '', pathMatch: 'full', redirectTo: 'login' },
    ]
  },

  // ──────────── Espace Investisseur / Client (CSFT §2.1 — Modules M2, M4) ────────────
  {
    path: 'client', loadComponent: () => layouts().then(m => m.ClientLayout), canActivate: [authGuard], children: [
      { path: 'dashboard', loadComponent: () => client1().then(m => m.ClientDashboard) },
      { path: 'emissions', loadComponent: () => client1().then(m => m.EmissionsList) },
      { path: 'emissions/:id', loadComponent: () => client1().then(m => m.EmissionDetail) },
      { path: 'orders', loadComponent: () => client1().then(m => m.OrdersList) },
      { path: 'orders/new/:emissionId', loadComponent: () => client1().then(m => m.OrderForm) },
      { path: 'orders/:id', loadComponent: () => client1().then(m => m.OrderDetail) },
      { path: 'orders/:id/edit', loadComponent: () => client1().then(m => m.OrderForm) },
      { path: 'portfolio', loadComponent: () => client2().then(m => m.Portfolio) },
      { path: 'documents', loadComponent: () => import('./features/client/documents-page').then(m => m.DocumentsList) },
      { path: 'validations', loadComponent: () => import('./features/client/cosignatures-page').then(m => m.CoSignatures) },
      { path: 'notifications', loadComponent: () => client2().then(m => m.Notifications) },
      { path: 'messagerie', loadComponent: () => import('./features/client/messagerie-page').then(m => m.MessageriePage) },
      { path: 'profile', loadComponent: () => client2().then(m => m.Profile) },
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
    ]
  },

  // ──────────── Espace Back-Office / Administration (CSFT §2.1 — Modules M1, M3, M6) ────────────
  {
    path: 'backoffice', loadComponent: () => layouts().then(m => m.BackofficeLayout), canActivate: [backofficeGuard], children: [
      { path: 'dashboard', loadComponent: () => bo().then(m => m.BoDashboard) },
      { path: 'discussions', loadComponent: () => import('./features/backoffice/bo-discussions').then(m => m.BoDiscussions) },
      { path: 'rapports', loadComponent: () => import('./features/backoffice/bo-rapports').then(m => m.BoRapports) },
      { path: 'emissions', loadComponent: () => bo().then(m => m.BoEmissions) },
      { path: 'orders', loadComponent: () => bo().then(m => m.BoOrders) },
      { path: 'livrables', loadComponent: () => import('./features/backoffice/bo-livrables').then(m => m.BoLivrables) },
      { path: 'clients', loadComponent: () => bo().then(m => m.BoClients) },
      { path: 'inscriptions', loadComponent: () => import('./features/backoffice/bo-face-verification').then(m => m.BoFaceVerification), canActivate: [requirePermission('CLIENT_MANAGE')] },
      { path: 'base-clients', loadComponent: () => import('./features/backoffice/bo-base-clients').then(m => m.BoBaseClients), canActivate: [requirePermission('CLIENT_MANAGE')] },
      { path: 'import-portefeuille', loadComponent: () => import('./features/backoffice/bo-import-portefeuille').then(m => m.BoImportPortefeuille), canActivate: [requirePermission('CLIENT_MANAGE')] },
      { path: 'otp-log', loadComponent: () => import('./features/backoffice/bo-otp-log').then(m => m.BoOtpLog) },
      { path: 'connection-qr', loadComponent: () => import('./features/backoffice/bo-connection-qr').then(m => m.BoConnectionQr) },
      { path: 'users', loadComponent: () => import('./features/backoffice/bo-users').then(m => m.BoUsers), canActivate: [adminGuard] },
      { path: 'signatures', loadComponent: () => import('./features/backoffice/bo-signatures').then(m => m.BoSignatures), canActivate: [requirePermission('CONFIG_MARCHE')] },
      { path: 'messagerie', loadComponent: () => import('./features/backoffice/bo-mail-settings').then(m => m.BoMailSettings), canActivate: [adminGuard] },
      { path: 'otp', loadComponent: () => import('./features/backoffice/bo-otp-settings').then(m => m.BoOtpSettings), canActivate: [adminGuard] },
      { path: 'ldap', loadComponent: () => import('./features/backoffice/bo-ldap-settings').then(m => m.BoLdapSettings), canActivate: [adminGuard] },
      { path: 'audit', loadComponent: () => bo().then(m => m.BoAudit), canActivate: [requirePermission('AUDIT_READ')] },
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
    ]
  },

  { path: '**', redirectTo: 'emissions' },
];
