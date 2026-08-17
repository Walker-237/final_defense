/**
 * Setup global des tests unitaires (referencé par `angular.json` → test →
 * `setupFiles`).
 *
 * Plusieurs composants formatent des montants avec le pipe
 * `number:...:'fr-FR'`. En production, la locale est enregistrée dans
 * `app.config.ts` ; les tests TestBed ne chargent pas ce fichier, si bien que
 * `DecimalPipe` lève « NG0701: Missing locale data for the locale "fr-FR" ».
 * On enregistre donc la locale une fois pour toute la suite.
 */
import { registerLocaleData } from '@angular/common';
import localeFr from '@angular/common/locales/fr';

registerLocaleData(localeFr, 'fr-FR');
