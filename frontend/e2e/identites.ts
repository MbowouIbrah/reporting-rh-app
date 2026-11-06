// Identités fictives des tests de bout en bout : aucune adresse ni aucun mot de passe écrits ailleurs.
export const DOMAINE = 'exemple.invalid' // domaine réservé (RFC 2606) : aucune boîte ne peut exister

export const courriel = (nom: string) => `${nom}@${DOMAINE}`

if (!process.env.E2E_PASSWORD) {
  throw new Error('E2E_PASSWORD absent : lancer les tests par playwright.config.ts, qui le définit.')
}
export const PW = process.env.E2E_PASSWORD
