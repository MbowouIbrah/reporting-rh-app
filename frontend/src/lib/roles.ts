/** Libellés métier des rôles (écran Accès, badge de l'en-tête). */
export const ROLES = {
  rh_admin: {
    libelle: 'Administrateur RH',
    resume: 'Tout voir, saisir les données, gérer les comptes, les périmètres et les réglages.',
  },
  lecteur_global: {
    libelle: 'Lecteur global',
    resume: 'Consulter tous les rapports, noms et marges compris. Aucune modification.',
  },
  lecteur_perimetre: {
    libelle: 'Lecteur de périmètre',
    resume: 'Consulter uniquement les services et sites de son périmètre. Les noms ne sont visibles que si c’est autorisé. Pas de marge.',
  },
} as const
