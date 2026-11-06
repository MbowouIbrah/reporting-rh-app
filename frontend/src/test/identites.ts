// Identités fictives des tests : domaine réservé (RFC 2606), mots de passe tirés au hasard à chaque appel.
export const DOMAINE = 'exemple.invalid'
export const courriel = (nom: string) => `${nom}@${DOMAINE}`
export const mdpTest = () => `t-${crypto.randomUUID()}`
