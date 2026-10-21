/** Catalogue des permissions : copie de `backend/app/security/policy.py` (CATALOGUE, MODELES), le serveur reste l'autorité. */
export interface PermissionCat {
  code: string
  libelle: string
  explication: string
  porteeTout: boolean // exige l'accès à toutes les données
}

export const LECTURE = 'lecture'
export const GESTION_COMPTES = 'comptes'
export const CATALOGUE: PermissionCat[] = [
  { code: LECTURE, libelle: 'Consulter les rapports', explication: 'Toujours accordée, limitée aux données visibles du compte.', porteeTout: false },
  { code: 'nominatif', libelle: 'Voir les noms et fiches individuelles', explication: 'Noms des salariés, fiche individuelle (chaque consultation est journalisée).', porteeTout: false },
  { code: 'marge', libelle: 'Voir le CA et la marge', explication: 'Le CA et la marge n’existent qu’au global.', porteeTout: true },
  { code: 'import', libelle: 'Importer la paie', explication: 'Dépôt des fichiers mensuels et décisions d’import.', porteeTout: true },
  { code: 'saisie', libelle: 'Corriger les données, saisir budgets et CA', explication: 'Corrections, budgets, CA et marge, clôture des périodes.', porteeTout: true },
  { code: 'referentiel', libelle: 'Gérer les sites, services, règles et périmètres', explication: 'Services, sites, rubriques, règles de calcul, périmètres.', porteeTout: true },
  { code: GESTION_COMPTES, libelle: 'Gérer les comptes et les droits', explication: 'Création des comptes, données visibles et permissions.', porteeTout: true },
  { code: 'journal', libelle: 'Consulter le journal', explication: 'Historique des connexions et des modifications.', porteeTout: true },
]
export const ACCORDABLES = CATALOGUE.filter((p) => p.code !== LECTURE).map((p) => p.code)
export const exigeTout = (code: string) => CATALOGUE.some((p) => p.code === code && p.porteeTout)

/** Modèles de pré-remplissage d'un nouveau compte (reprise des anciens rôles). */
export const MODELES = [
  { code: 'admin', fonction: 'Administrateur RH', tout: true, permissions: ACCORDABLES },
  { code: 'global', fonction: 'Lecteur global', tout: true, permissions: ['nominatif', 'marge'] },
  { code: 'perimetre', fonction: 'Lecteur de périmètre', tout: false, permissions: [] as string[] },
]
