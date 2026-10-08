import { useRef, useState } from 'react'
import { usePeriodesAdmin } from '../../api/admin'
import {
  telecharger,
  useAnnulerLot,
  useAnomalies,
  useCreerLot,
  useDonneesMois,
  useListes,
  useLots,
  useSalariesAdmin,
  useSaisirLigne,
  useValiderLot,
  type Lot,
} from '../../api/donnees'
import AdminNav from '../../components/AdminNav'
import Etat from '../../components/Etat'
import { Badge, Bouton, Carte, ChoixFichier, Champ, ChampMontant, Confirmer } from '../../components/Kit'
import { fcfa, MOIS } from '../../lib/format'

const STATUTS: Record<Lot['statut'], [string, 'succes' | 'alerte' | 'erreur' | 'neutre']> = {
  pret: ['À valider', 'alerte'],
  rejete: ['Rejeté', 'erreur'],
  valide: ['Importé', 'succes'],
  annule: ['Annulé', 'neutre'],
}
const CHAMPS = [
  ['poste', 'Poste'],
  ['type_contrat', 'Type de contrat'],
  ['activite', 'Activité'],
  ['site', 'Site'],
  ['service', 'Service'],
] as const
type Saisie = {
  matricule: string
  poste: string
  type_contrat: string
  activite: string
  site: string
  service: string
  montants: Record<string, string>
}
const montantOk = (v: string) => v.trim() === '' || /^-?\d+([.,]\d{0,3})?$/.test(v.trim())

function ControleLot({ lot, onFini }: { lot: Lot; onFini: () => void }) {
  const anos = useAnomalies(lot.id)
  const valider = useValiderLot()
  const annuler = useAnnulerLot()
  const [err, setErr] = useState<string | null>(null)
  const pret = lot.statut === 'pret'
  return (
    <div className="apercu-import" role="status">
      <p>
        <strong>{lot.fichier_nom}</strong> : {lot.nb_lignes} ligne(s) lue(s), <strong>{lot.nb_bloquants}</strong> erreur(s) bloquante(s),{' '}
        {lot.nb_avert} avertissement(s). <Badge ton={STATUTS[lot.statut][1]}>{STATUTS[lot.statut][0]}</Badge>
      </p>
      {(anos.data?.length ?? 0) > 0 && (
        <ul>
          {anos.data?.slice(0, 12).map((a, i) => (
            <li key={i}>
              {a.gravite === 'bloquant' ? 'Erreur' : 'Avertissement'} · {a.ligne ? `ligne ${a.ligne} · ` : ''}
              {a.colonne ? `${a.colonne} · ` : ''}
              {a.message}
            </li>
          ))}
          {anos.data && anos.data.length > 12 && <li>… et {anos.data.length - 12} autres.</li>}
        </ul>
      )}
      {err && (
        <p className="champ-erreur" role="alert">
          {err}
        </p>
      )}
      {pret && (
        <Bouton
          disabled={valider.isPending}
          onClick={() => valider.mutate(lot.id, { onSuccess: onFini, onError: (e) => setErr(e.message) })}
        >
          Valider l’import
        </Bouton>
      )}{' '}
      <Bouton
        variante="lien"
        onClick={() => (pret ? annuler.mutate(lot.id, { onSuccess: onFini, onError: (e) => setErr(e.message) }) : onFini())}
      >
        {pret ? 'Annuler' : 'Fermer'}
      </Bouton>
      {!pret && lot.nb_bloquants > 0 && <p className="note">Corrigez le fichier puis réimportez-le. Rien n’a été enregistré.</p>}
    </div>
  )
}

export default function DonneesMensuelles({ periode }: { periode?: { annee: number; mois: number } } = {}) {
  const periodes = usePeriodesAdmin()
  const aujourdhui = new Date()
  const derniere = periodes.data?.[periodes.data.length - 1]
  const [choix, setChoix] = useState<{ annee: number; mois: number } | null>(null)
  const annee = periode?.annee ?? choix?.annee ?? derniere?.annee ?? aujourdhui.getFullYear()
  const mois = periode?.mois ?? choix?.mois ?? derniere?.mois ?? aujourdhui.getMonth() + 1
  const donnees = useDonneesMois(annee, mois)
  const lots = useLots()
  const salaries = useSalariesAdmin()
  const listes = useListes()
  const creerLot = useCreerLot()
  const saisir = useSaisirLigne()
  const annulerLot = useAnnulerLot()
  const fichier = useRef<HTMLInputElement>(null)
  const [lotId, setLotId] = useState<number | null>(null)
  const [errImport, setErrImport] = useState<string | null>(null)
  const [saisie, setSaisie] = useState<Saisie | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [aAnnuler, setAAnnuler] = useState<Lot | null>(null)

  if (donnees.isLoading || periodes.isLoading) return <Etat type="chargement" />
  if (donnees.isError) return <Etat type="erreur" onRetry={() => donnees.refetch()} />
  const d = donnees.data
  if (!d) return null
  const lot = lots.data?.find((l) => l.id === lotId)
  const annees = Array.from({ length: 6 }, (_, i) => aujourdhui.getFullYear() + 1 - i)

  const ouvrirSaisie = (matricule: string) => {
    const ligne = d.lignes.find((l) => l.matricule === matricule)
    const fiche = salaries.data?.find((s) => s.matricule === matricule)
    const src = ligne ?? fiche
    setErr(null)
    setSaisie({
      matricule,
      poste: src?.poste ?? '',
      type_contrat: src?.type_contrat ?? '',
      activite: src?.activite ?? '',
      site: src?.site ?? '',
      service: src?.service ?? '',
      montants: Object.fromEntries(Object.entries(ligne?.montants ?? {}).map(([k, v]) => [k, v.replace(/\.?0+$/, '')])),
    })
  }
  const enregistrer = () => {
    if (!saisie) return
    const mauvais = Object.entries(saisie.montants).find(([, v]) => !montantOk(v))
    if (mauvais) return setErr(`Montant invalide : ${mauvais[0]}`)
    const { matricule, montants, ...attrs } = saisie
    saisir.mutate(
      {
        annee,
        mois,
        matricule,
        ...Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, v || undefined])),
        montants: Object.fromEntries(Object.entries(montants).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim().replace(',', '.')])),
      },
      { onSuccess: () => setSaisie(null), onError: (e) => setErr(e.message) },
    )
  }
  const importer = (f: File | undefined) => {
    setErrImport(null)
    if (!f) return
    creerLot.mutate(f, {
      onSuccess: (l) => setLotId(l.id),
      onError: (e) => setErrImport(e.message),
    })
    if (fichier.current) fichier.current.value = ''
  }

  return (
    <>
      {!periode && <AdminNav />}
      {!periode && <h2>Données mensuelles</h2>}
      <Carte titre={periode ? 'Fichier de paie du mois' : 'Choisir le mois'}>
        {!periode && (
        <div className="filtres">
          <label>
            Mois
            <select value={mois} onChange={(e) => setChoix({ annee, mois: Number(e.target.value) })}>
              {MOIS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label>
            Année
            <select value={annee} onChange={(e) => setChoix({ mois, annee: Number(e.target.value) })}>
              {annees.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </label>
        </div>
        )}
        <ol className="etapes">
          <li>
            <Bouton
              variante="secondaire"
              onClick={() => telecharger(`/donnees/modele.xlsx?annee=${annee}&mois=${mois}`, `donnees_${annee}_${String(mois).padStart(2, '0')}.xlsx`)}
            >
              Télécharger le modèle du mois
            </Bouton>
            <span className="note"> Pré-rempli avec vos employés actifs.</span>
          </li>
          <li>
            <ChoixFichier libelle="Importer le fichier rempli" accept=".xlsx" inputRef={fichier} onFichier={importer} />
            <span className="note"> Un contrôle s’affiche avant l’enregistrement.</span>
          </li>
          <li>
            <Bouton variante="secondaire" onClick={() => ouvrirSaisie(salaries.data?.[0]?.matricule ?? '')} disabled={!salaries.data?.length}>
              Ajouter ou corriger une ligne
            </Bouton>
            <span className="note"> Pour un seul employé, sans passer par Excel.</span>
          </li>
        </ol>
        {errImport && (
          <p className="champ-erreur" role="alert" style={{ whiteSpace: 'pre-line' }}>
            {errImport}
          </p>
        )}
        {lot && <ControleLot lot={lot} onFini={() => setLotId(null)} />}
      </Carte>

      <Carte titre={`Données de ${MOIS[mois - 1]} ${annee} (${d.lignes.length} employé${d.lignes.length > 1 ? 's' : ''})`}>
        <div className="tableau-defilant">
          <table className="dense">
            <thead>
              <tr>
                <th scope="col">Matricule</th>
                <th scope="col">Nom</th>
                <th scope="col">Service</th>
                <th scope="col">Site</th>
                <th scope="col" className="num">Total (FCFA)</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {d.lignes.map((l) => (
                <tr key={l.matricule}>
                  <th scope="row">{l.matricule}</th>
                  <td>{l.nom}</td>
                  <td>{l.service}</td>
                  <td>{l.site}</td>
                  <td className="num">{fcfa(l.total)}</td>
                  <td><Bouton variante="lien" onClick={() => ouvrirSaisie(l.matricule)}>Corriger</Bouton></td>
                </tr>
              ))}
              {d.lignes.length === 0 && (
                <tr>
                  <td colSpan={6}>Aucune donnée pour ce mois. Téléchargez le modèle, remplissez-le, puis importez-le.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Carte>

      <Carte titre="Historique des imports">
        <div className="tableau-defilant">
          <table className="dense">
            <thead>
              <tr>
                <th scope="col">Fichier</th>
                <th scope="col">Date</th>
                <th scope="col">Lignes</th>
                <th scope="col">Statut</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {(lots.data ?? []).slice(0, 15).map((l) => (
                <tr key={l.id}>
                  <th scope="row">{l.fichier_nom}</th>
                  <td>{l.cree_le ? new Date(l.cree_le).toLocaleString('fr-FR') : '—'}</td>
                  <td className="num">{l.nb_lignes}</td>
                  <td>
                    <Badge ton={STATUTS[l.statut][1]}>{STATUTS[l.statut][0]}</Badge>
                  </td>
                  <td>
                    {l.statut === 'pret' && <Bouton variante="lien" onClick={() => setLotId(l.id)}>Contrôler</Bouton>}
                    {l.statut === 'valide' && <Bouton variante="lien" onClick={() => setAAnnuler(l)}>Annuler l’import</Bouton>}
                  </td>
                </tr>
              ))}
              {(lots.data ?? []).length === 0 && (
                <tr>
                  <td colSpan={5}>Aucun import pour l’instant.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Carte>

      <Confirmer
        ouvert={!!aAnnuler}
        titre="Annuler l’import"
        confirmer="Annuler l’import"
        onConfirmer={() => aAnnuler && annulerLot.mutate(aAnnuler.id, { onSettled: () => setAAnnuler(null) })}
        onAnnuler={() => setAAnnuler(null)}
      >
        <p>Les données précédentes remplacées par « {aAnnuler?.fichier_nom} » seront restaurées.</p>
      </Confirmer>

      <Confirmer
        ouvert={!!saisie}
        titre={`Ligne de ${MOIS[mois - 1]} ${annee}`}
        confirmer="Enregistrer"
        desactive={!saisie?.matricule || saisir.isPending}
        onConfirmer={enregistrer}
        onAnnuler={() => setSaisie(null)}
      >
        {saisie && (
          <div className="formulaire-grille">
            <Champ label="Employé">
              {(p) => (
                <select {...p} value={saisie.matricule} onChange={(e) => ouvrirSaisie(e.target.value)}>
                  {salaries.data?.map((s) => (
                    <option key={s.matricule} value={s.matricule}>
                      {s.matricule} — {s.nom}
                    </option>
                  ))}
                </select>
              )}
            </Champ>
            {CHAMPS.map(([c, lib]) => (
              <Champ key={c} label={lib}>
                {(p) => (
                  <select {...p} value={saisie[c]} onChange={(e) => setSaisie({ ...saisie, [c]: e.target.value })}>
                    <option value="">(non renseigné)</option>
                    {listes.data?.[c].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                )}
              </Champ>
            ))}
            {d.rubriques.map((r) => (
              <ChampMontant
                key={r.libelle}
                label={`${r.libelle}${r.unite === 'jours' ? ' (jours)' : ''}`}
                valeur={saisie.montants[r.libelle] ?? ''}
                onChange={(v) => setSaisie({ ...saisie, montants: { ...saisie.montants, [r.libelle]: v } })}
              />
            ))}
            <p className="note">Enregistrer remplace toute la ligne de cet employé pour ce mois.</p>
            {err && (
              <p className="champ-erreur" role="alert" style={{ whiteSpace: 'pre-line' }}>
                {err}
              </p>
            )}
          </div>
        )}
      </Confirmer>
    </>
  )
}
