/** Graphiques de la page Graphes, présentés par groupes de 4 au plus. Logique pure (pas d'affichage). */

export interface InfoGraphe {
  id: string
  titre: string
  /** Graphique proposé seulement si la série mensuelle a une valeur pour cette clé. */
  cle?: string
}

/** Catalogue des graphiques, dans l'ordre d'affichage. Identifiants stables : les groupes
 *  de l'utilisateur y font référence. */
export const GRAPHES: InfoGraphe[] = [
  { id: 'ms', titre: 'Masse salariale mensuelle (FCFA)' },
  { id: 'effectif', titre: 'Effectif' },
  { id: 'frais', titre: 'Frais de mission (FCFA)' },
  { id: 'remu', titre: 'Rémunération globale (FCFA)' },
  { id: 'salaire', titre: 'Salaire par mois (FCFA)', cle: 'sal' },
  { id: 'primes', titre: 'Primes par mois (FCFA)', cle: 'prim' },
  { id: 'ventes', titre: 'Ventes par mois', cle: 'ventes' },
  { id: 'clients', titre: 'Clients par mois', cle: 'clients' },
  { id: 'or', titre: 'OR par productif et par mois', cle: 'orProd' },
  { id: 'ca', titre: 'CA par mois (FCFA)', cle: 'ca' },
  { id: 'marge', titre: 'Marge par mois (FCFA)', cle: 'marge' },
  { id: 'commissions', titre: 'Commissions par mois (FCFA)', cle: 'comm' },
  { id: 'productivite', titre: 'Productivité par mois', cle: 'prod' },
  { id: 'factures', titre: 'Factures par mois', cle: 'fact' },
  { id: 'absences', titre: 'Absences par mois (jours)', cle: 'absences' },
  { id: 'assurance', titre: 'Assurance par mois (FCFA)', cle: 'assurance' },
  { id: 'formation', titre: 'Formation par mois (FCFA)', cle: 'formation' },
  { id: 'logement', titre: 'Logement site déporté par mois (FCFA)', cle: 'logement' },
  { id: 'credit', titre: 'Crédit téléphonique par mois (FCFA)', cle: 'credit' },
  { id: 'carburant', titre: 'Carburant par mois (FCFA)', cle: 'carburant' },
]

export interface Groupe {
  id: string
  nom: string
  graphes: string[]
}

/** Groupes d'origine (4 graphiques chacun, d'après les familles du calcul). Identifiants stables. */
export const GROUPES_ORIGINE: Groupe[] = [
  { id: 'ensemble', nom: 'Effectif et masse salariale', graphes: ['ms', 'remu', 'effectif', 'absences'] },
  { id: 'salaire', nom: 'Salaires, primes et charges', graphes: ['salaire', 'primes', 'assurance', 'formation'] },
  { id: 'avantages', nom: 'Frais et avantages', graphes: ['frais', 'logement', 'credit', 'carburant'] },
  { id: 'ventes', nom: 'Ventes, marge et commissions', graphes: ['ca', 'marge', 'commissions', 'ventes'] },
  { id: 'ateliers', nom: 'Atelier et productivité', graphes: ['clients', 'factures', 'productivite', 'or'] },
]

/** Réglage de l'utilisateur : ses groupes, l'ordre des groupes affichés (un groupe d'origine
 *  absent de `ordre` est masqué) et la vue d'ouverture (`tout` ou l'identifiant d'un groupe). */
export interface ConfigGroupes {
  perso: Groupe[]
  ordre: string[]
  defaut: string
  /** Noms personnels des groupes d'origine, vus par l'utilisateur seul ; priment sur les noms communs. */
  noms?: Record<string, string>
}

export const VUE_TOUT = 'tout'
export const MAX_PAR_GROUPE = 4
export const MAX_NOM = 60

export const CONFIG_ORIGINE: ConfigGroupes = {
  perso: [],
  ordre: GROUPES_ORIGINE.map((g) => g.id),
  defaut: 'ensemble',
}

/** Groupes d'origine affichés dans leur ordre et ouverture d'origine ; les groupes personnels restent (masqués). */
export function retablirOrigine(config: ConfigGroupes): ConfigGroupes {
  return { ...config, ordre: CONFIG_ORIGINE.ordre, defaut: CONFIG_ORIGINE.defaut }
}

const texte = (v: unknown, max: number): v is string => typeof v === 'string' && v.length >= 1 && v.length <= max
const liste = (v: unknown): v is unknown[] => Array.isArray(v)

/** Valide un réglage venu du serveur ou du navigateur ; null si la forme n'est pas la bonne. */
export function lireConfig(v: unknown): ConfigGroupes | null {
  if (typeof v !== 'object' || v === null) return null
  const { perso, ordre, defaut, noms } = v as Record<string, unknown>
  if (!liste(perso) || perso.length > 20 || !liste(ordre) || ordre.length > 40 || !texte(defaut, 50)) return null
  if (!ordre.every((x) => texte(x, 50))) return null
  const groupes: Groupe[] = []
  for (const p of perso) {
    if (typeof p !== 'object' || p === null) return null
    const { id, nom, graphes } = p as Record<string, unknown>
    if (!texte(id, 50) || typeof nom !== 'string' || !texte(nom.trim(), MAX_NOM)) return null
    if (!liste(graphes) || graphes.length < 1 || graphes.length > MAX_PAR_GROUPE || !graphes.every((x) => texte(x, 50))) return null
    groupes.push({ id, nom: nom.trim(), graphes: graphes as string[] })
  }
  const persos = noms === undefined ? null : lireNoms(noms)
  return persos && Object.keys(persos).length ? { perso: groupes, ordre: ordre as string[], defaut, noms: persos } : { perso: groupes, ordre: ordre as string[], defaut }
}

/** Noms choisis par l'administration pour les groupes d'origine (identifiant -> nom) ; null si la forme
 *  n'est pas la bonne. Les entrées invalides sont ignorées. */
export function lireNoms(v: unknown): Record<string, string> | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
  const res: Record<string, string> = {}
  for (const [id, nom] of Object.entries(v)) {
    if (typeof nom === 'string' && texte(nom.trim(), MAX_NOM)) res[id] = nom.trim()
  }
  return res
}

/** Tous les groupes connus (ceux d'origine, puis ceux de l'utilisateur), affichés ou non.
 *  `noms` renomme les groupes d'origine seulement ; les groupes personnels gardent leur nom. */
export function tousLesGroupes(config: ConfigGroupes, noms: Record<string, string> = {}): Groupe[] {
  return [...GROUPES_ORIGINE.map((g) => ({ ...g, nom: config.noms?.[g.id] ?? noms[g.id] ?? g.nom })), ...config.perso]
}

/** Groupes à montrer, dans l'ordre choisi. Un identifiant inconnu est ignoré, un graphique sans donnée
 *  est retiré de son groupe, un groupe devenu vide n'est pas proposé. */
export function groupesAffiches(config: ConfigGroupes, dispo: Set<string>, noms: Record<string, string> = {}): Groupe[] {
  const connus = new Set(GRAPHES.map((g) => g.id))
  const parId = new Map(tousLesGroupes(config, noms).map((g) => [g.id, g]))
  const vus = new Set<string>()
  const res: Groupe[] = []
  for (const id of config.ordre) {
    const g = parId.get(id)
    if (!g || vus.has(id)) continue
    vus.add(id)
    const graphes = g.graphes.filter((x) => connus.has(x) && dispo.has(x))
    if (graphes.length) res.push({ ...g, graphes })
  }
  return res
}

/** Vue à l'ouverture : le réglage « par défaut » s'il est utilisable, sinon le premier groupe affiché. */
export function vueInitiale(config: ConfigGroupes, affiches: Groupe[]): string {
  if (config.defaut === VUE_TOUT || affiches.some((g) => g.id === config.defaut)) return config.defaut
  return affiches[0]?.id ?? VUE_TOUT
}

const titreCourt = (id: string) => GRAPHES.find((g) => g.id === id)?.titre.replace(/\s*\(FCFA\)/, '')

/** Contenu d'un groupe en une ligne : les titres des graphiques, sans l'unité. */
export function descGroupe(g: Pick<Groupe, 'graphes'>): string {
  return g.graphes.map(titreCourt).filter(Boolean).join(', ')
}

export function nouvelId(): string {
  return `p-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}
