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

export interface Me {
  id: number
  email: string
  roles: { role: string; perimetre_id: number | null; nominatif: boolean }[]
  permissions: string[]
}

export interface Periode {
  annee: number
  mois: number
  statut: string
}

export interface Filtres {
  services: string[]
  sites: string[]
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
    commissions: Cell
    primes_total: Cell
    primes: ({ rubrique: string } & Cell)[]
    ca?: Val
    marge?: Val
    taux_marge?: Val
  }
  a_type_charge: ({ rubrique: string; exclu: boolean } & Cell & Budget)[]
  b_service_activite: {
    service: string
    total: Cell & Budget
    effectif: Cell
    activites: ({ activite: string; effectif: Cell } & Cell)[]
  }[]
  c_site: { site: string; ms: Cell & Budget; effectif: { m: number; m1: number | null } }[]
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
  ms: Dec | null
  effectif: number | null
  absences: Dec | null
  commissions: Dec | null
  primes: Dec | null
  ca?: Val
  marge?: Val
  taux_marge?: Val
}

export interface Annuel {
  serie_n: SerieMois[]
  serie_n1: SerieMois[]
  cumul_ytd: Cell & { nb_mois: number; nb_mois_n1: number }
  moyenne_mensuelle: Cell
  cumul_annee_n1: Dec | null
  marge_ytd?: Val
  nb_mois_marge?: number
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
    present: boolean
    service: string | null
    site: string | null
    contrat: string | null
    rubriques: Record<string, Val> | null
    total: Dec | null
  }[]
  cumul: Dec
  nb_mois: number
  moyenne: Val
}
