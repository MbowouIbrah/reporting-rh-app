/** Montant décimal exact sérialisé en chaîne. */
export type Dec = string
/** Valeur d'un indicateur : décimal, 'n/a' (division par zéro) ou null (donnée absente). */
export type Val = Dec | 'n/a' | null

export interface Budget {
  budget?: Val
  ecart?: Val
  ecart_pct?: Val
}

export interface Cell {
  m1: Val
  m: Val
  var: Val
  var_pct: Val
}

/** Cellule dont le total manque une case attendue (saisie incomplète). */
export type CellPartiel = Cell & { partiel?: true }

/** Cellule du réel avec son objectif (budget, écart, écart %) ; `budget_partiel` si une case attendue de l'objectif manque. */
export type CellObjectif = CellPartiel & Budget & { budget_partiel?: true }

/** Ligne du bloc ACTIVITÉ ; `activite` vaut null tant qu'aucune donnée d'activité n'existe. */
export type LigneActivite = { cle: string; libelle: string } & CellObjectif

/** Objectifs d'un mois (null = non défini) ; `ca` et `marge` absents sans la permission marge:read. */
export interface Objectifs {
  ms: Dec | null
  frais_mission: Dec | null
  commissions: Dec | null
  remuneration: Dec | null
  ventes: Dec | null
  clients: Dec | null
  factures: Dec | null
  productivite: Dec | null
  ca?: Dec | null
  marge?: Dec | null
}

/** Indicateurs d'activité d'un mois (valeurs brutes, null si non renseignés). */
export interface ActiviteMois {
  ventes: Dec | null
  clients: Dec | null
  productivite: Dec | null
  or: Dec | null
  devis: Dec | null
  factures: Dec | null
  productifs: Dec | null
  or_par_productif: Dec | null
  factures_par_productif: Dec | null
}

/** Activité d'un employé sur un mois ou sur l'année ; CA et marge individuels absents sans la permission marge:read. */
export interface ActiviteIndividuelle {
  ventes: Dec | null
  clients: Dec | null
  productivite: Dec | null
  ca_individuel?: Dec | null
  marge_individuelle?: Dec | null
}

export interface Me {
  id: number
  email: string
  nom: string
  fonction: string
  permissions: string[]
}

export interface Periode {
  annee: number
  mois: number
}


export interface Filtres {
  services: string[]
  sites: string[]
  types_site?: string[]
  /** Type de chaque site proposé : la liste Site suit le type de site choisi. */
  type_par_site?: Record<string, string>
  postes?: string[]
  activites?: string[]
  types_contrat?: string[]
  /** N-uplets présents [service, site, type de site, activité, contrat, poste] ; '' = sans valeur. */
  combinaisons?: string[][]
}

export interface Salarie {
  matricule: string
  nom: string
}

export interface Controle {
  controle: string
  ecart: Dec
  bloquant: boolean
}

export interface Indicateurs {
  contrat: string
  debut: number | null
  recrutements: number | null
  departs: number | null
  fin: number
  taux_rotation: Val
  absences: Dec
  taux_absenteisme: Val
}

export interface Mensuel {
  synthese: {
    ms: Cell & { budget: Val; ecart: Val; ecart_pct: Val }
    effectif: {
      debut: number | null
      recrutements: number | null
      departs: number | null
      fin: number
      variation: Val
    }
    taux_rotation: Val
    absences: Cell
    taux_absenteisme: Val
    exclus: Dec
    remuneration_globale: Dec
    commissions: Cell
    primes_total: Cell
    primes: ({ rubrique: string } & Cell)[]
    salaire?: Cell
    primes_toutes?: Cell
    ca?: Val
    marge?: Val
    taux_marge?: Val
  }
  a_type_charge: ({ rubrique: string; exclu: boolean } & Cell & Budget)[]
  /** Absent sans la permission marge:read. */
  lignes_ca_marge?: { ca: CellObjectif; marge: CellObjectif }
  /** Ligne « dont Frais de mission » : comptée dans la masse salariale, avec le budget de la rubrique. */
  frais_mission?: Cell & Budget
  objectifs?: Objectifs
  /** Un objectif d'activité a une case attendue vide. */
  budget_partiel?: boolean
  activite: LigneActivite[] | null
  b_service_activite: {
    service: string
    total: Cell & Budget
    effectif: Cell
    activites: ({ activite: string; effectif: Cell } & Cell)[]
    /** Masse salariale et effectif du service par nature de contrat (CDI, CDD, MAD). */
    ms_contrat?: Record<string, Cell>
    effectif_contrat?: Record<string, Cell>
  }[]
  c_site: {
    site: string
    ms: Cell & Budget
    effectif: Cell
    /** Effectif du site par nature de contrat (CDI, CDD, MAD), dans l'ordre du référentiel. */
    effectif_contrat?: Record<string, Cell>
    /** Masse salariale du site par nature de contrat, mêmes clés que effectif_contrat. */
    ms_contrat?: Record<string, Cell>
  }[]
  /** TOTAL GÉNÉRAL de la répartition par site : somme des sites affichés. */
  c_site_total?: { ms: Cell & Budget; effectif: Cell }
  d_contrat: {
    effectifs: ({ contrat: string } & Cell)[]
    indicateurs: Indicateurs[]
    total: Cell
    ventilation: { contrat: string; activite: string; ms: Cell; effectif: Cell }[]
  }
  controles: Controle[]
}


export interface SerieMois {
  mois: number
  /** Année civile du mois (l'exercice fiscal chevauche deux années). */
  annee?: number
  ms: Dec | null
  effectif: number | null
  absences: Dec | null
  commissions: Dec | null
  primes: Dec | null
  /** Salaire brut garantie. */
  salaire?: Dec | null
  /** Les six primes (Bonus, exceptionnelles, ventes, résultats, productivité, commission). */
  primes_toutes?: Dec | null
  frais_mission: Dec | null
  logement: Dec | null
  assurance?: Dec | null
  formation?: Dec | null
  carburant?: Dec | null
  credit_telephonique?: Dec | null
  remuneration: Dec | null
  effectif_contrat: Record<string, number> | null
  ca?: Val
  marge?: Val
  taux_marge?: Val
  activite?: ActiviteMois
  /** Objectifs du mois (série N seulement). */
  objectifs?: Objectifs
}

export interface Annuel {
  serie_n: SerieMois[]
  serie_n1: SerieMois[]
  cumul_ytd: Cell & { nb_mois: number; nb_mois_n1: number }
  moyenne_mensuelle: Cell
  cumul_annee_n1: Dec | null
  marge_ytd?: Val
  nb_mois_marge?: number
  nb_mois_ca?: number
  ca_ytd?: Val
  taux_marge_ytd?: Val
  commissions_ytd: Dec | null
  primes_ytd: Dec | null
  ca_cumul?: Cell
  commissions_cumul: Cell
  primes_cumul: Cell
  frais_mission_ytd: Dec | null
  logement_ytd: Dec | null
  effectif_moyen: Cell
  /** Dernier mois saisi de la période : base de l'effectif de fin. */
  mois_fin: number | null
  annee_fin?: number | null
  effectif_fin: Cell
  effectif_fin_contrat: Record<string, Cell & { part: Val }>
  mad_fin: Cell
  mad_deportes_fin: Cell & { part: Val }
  ms_contrat: Record<string, Cell & { part: Val }>
  ca_avec_marge?: Val
  ca_par_effectif?: Cell
  a_type_charge: Mensuel['a_type_charge']
  lignes_ca_marge?: Mensuel['lignes_ca_marge']
  frais_mission?: Mensuel['frais_mission']
  budget_partiel?: boolean
  activite: LigneActivite[] | null
  b_service_activite: Mensuel['b_service_activite']
  c_site: Mensuel['c_site']
  c_site_total?: Mensuel['c_site_total']
  d_contrat: Mensuel['d_contrat']
  par_service: ({
    service: string
    nb_mois: number
    nb_mois_n1: number
    moy_m: Val
    moy_m1: Val
    ecart_moy_pct: Val
  } & Cell)[]
}

export interface Individuel {
  matricule: string
  nom: string
  annee: number
  mois: {
    mois: number
    /** Vraie année du mois (exercice fiscal : avril → mars). */
    annee?: number
    present: boolean
    service: string | null
    site: string | null
    contrat: string | null
    rubriques: Record<string, Val> | null
    total: Dec | null
    activite?: ActiviteIndividuelle | null
  }[]
  cumul: Dec
  nb_mois: number
  moyenne: Val
  /** Ventes, clients, CA et marge s'additionnent ; la productivité est la moyenne des mois renseignés. */
  activite_total?: ActiviteIndividuelle
}

export interface IndividuelTous {
  annee: number
  matricule: string | null
  nom: string | null
  rubriques: string[]
  /** Colonnes exclues du total de ligne (hachurées, hors TOTAL MENSUEL). */
  exclues?: string[]
  /** Rubriques de DONNEES derrière chaque colonne (ordre et hachuré enregistrés par rubrique). */
  sources?: Record<string, string[]>
  /** Total de l'année des indicateurs d'activité (serveur). */
  activite_total?: ActiviteIndividuelle
  mois: {
    mois: number
    annee?: number
    present: boolean
    effectif?: number
    montants?: Record<string, Val>
    staff?: Record<string, number>
    total?: Dec
    /** Un site déporté figure dans le mois (sinon logement sans objet). */
    deporte?: boolean
    /** Activité du périmètre ; CA et marge individuels absents sans la permission marge:read. */
    activite?: ActiviteIndividuelle
  }[]
}
