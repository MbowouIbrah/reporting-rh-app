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
  { code: LECTURE, libelle: 'Consulter les rapports', explication: 'Voir les tableaux de bord de ses données.', porteeTout: false },
  { code: 'nominatif', libelle: 'Voir les noms et fiches individuelles', explication: 'Voir le nom et la fiche de chaque salarié.', porteeTout: false },
  { code: 'marge', libelle: 'Voir le CA et la marge', explication: 'Voir le chiffre d’affaires et la marge.', porteeTout: true },
  { code: 'import', libelle: 'Importer la paie', explication: 'Déposer chaque mois le fichier de paie.', porteeTout: true },
  { code: 'saisie', libelle: 'Corriger les données, saisir budgets et CA', explication: 'Corriger les chiffres, saisir budgets et CA.', porteeTout: true },
  { code: 'referentiel', libelle: 'Gérer les sites, services, règles et périmètres', explication: 'Ajouter ou modifier sites, services et règles.', porteeTout: true },
  { code: GESTION_COMPTES, libelle: 'Gérer les comptes et les droits', explication: 'Créer des comptes et leur donner des droits.', porteeTout: true },
  { code: 'journal', libelle: 'Consulter le journal', explication: 'Voir qui s’est connecté et qui a modifié quoi.', porteeTout: true },
]
export const ACCORDABLES = CATALOGUE.filter((p) => p.code !== LECTURE).map((p) => p.code)
export const exigeTout = (code: string) => CATALOGUE.some((p) => p.code === code && p.porteeTout)

/** Modèles de pré-remplissage d'un nouveau compte (reprise des anciens rôles). */
export const MODELES = [
  { code: 'admin', fonction: 'Administrateur RH', tout: true, permissions: ACCORDABLES },
  { code: 'global', fonction: 'Lecteur global', tout: true, permissions: ['nominatif', 'marge'] },
  { code: 'perimetre', fonction: 'Lecteur de périmètre', tout: false, permissions: [] as string[] },
]
