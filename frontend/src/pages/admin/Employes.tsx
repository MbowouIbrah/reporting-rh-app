import { useRef, useState } from 'react'
import {
  telecharger,
  useCreerSalarie,
  useImportSalaries,
  useListes,
  useModifierSalarie,
  useSalariesAdmin,
  type Fiche,
  type ResultatImport,
} from '../../api/donnees'
import AdminNav from '../../components/AdminNav'
import Etat from '../../components/Etat'
import { Badge, Bouton, Carte, ChoixFichier, Champ, Confirmer } from '../../components/Kit'

const VIDE: Omit<Fiche, 'id'> = {
  matricule: '',
  nom: '',
  poste: null,
  type_contrat: null,
  activite: null,
  site: null,
  service: null,
  actif: true,
}
const CHAMPS = [
  ['poste', 'Poste'],
  ['type_contrat', 'Type de contrat'],
  ['activite', 'Activité'],
  ['site', 'Site'],
  ['service', 'Service'],
] as const

export default function Employes() {
  const q = useSalariesAdmin()
  const listes = useListes()
  const creer = useCreerSalarie()
  const modifier = useModifierSalarie()
  const importer = useImportSalaries()
  const fichier = useRef<HTMLInputElement>(null)
  const [recherche, setRecherche] = useState('')
  const [edition, setEdition] = useState<(Omit<Fiche, 'id'> & { id?: number }) | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [fic, setFic] = useState<File | null>(null)
  const [apercu, setApercu] = useState<ResultatImport | null>(null)
  const [errImport, setErrImport] = useState<string | null>(null)

  if (q.isLoading || q.isError)
    return (
      <>
        <AdminNav />
        <h2>Employés</h2>
        {q.isLoading ? <Etat type="chargement" /> : <Etat type="erreur" onRetry={() => q.refetch()} />}
      </>
    )

  const mots = recherche.trim().toLowerCase()
  const liste = (q.data ?? []).filter((s) => !mots || `${s.matricule} ${s.nom} ${s.service ?? ''} ${s.site ?? ''}`.toLowerCase().includes(mots))

  const enregistrer = () => {
    if (!edition) return
    const opts = { onSuccess: () => setEdition(null), onError: (e: Error) => setErr(e.message) }
    if (edition.id === undefined) creer.mutate(edition, opts)
    else modifier.mutate(edition as Fiche, opts)
  }
  const choisir = (f: File | undefined) => {
    setApercu(null)
    setErrImport(null)
    setFic(f ?? null)
    if (f) importer.mutate({ f, simuler: true }, { onSuccess: setApercu, onError: (e) => setErrImport(e.message) })
  }
  const terminer = () => {
    setFic(null)
    setApercu(null)
    if (fichier.current) fichier.current.value = ''
  }
  const confirmerImport = () => {
    if (!fic) return
    importer.mutate({ f: fic, simuler: false }, { onSuccess: terminer, onError: (e) => setErrImport(e.message) })
  }
  const maj = (c: string, v: string | boolean | null) => setEdition((e) => (e ? { ...e, [c]: v } : e))

  return (
    <>
      <AdminNav />
      <h2>Employés</h2>
      <Carte
        titre="Ajouter des employés"
        actions={
          <Bouton
            onClick={() => {
              setErr(null)
              setEdition({ ...VIDE })
            }}
          >
            Ajouter un employé
          </Bouton>
        }
      >
        <ol className="etapes">
          <li>
            <Bouton variante="secondaire" onClick={() => telecharger('/salaries/modele.xlsx', 'modele_employes.xlsx')}>
              Télécharger le modèle Excel
            </Bouton>
            <span className="note"> Une ligne par employé (matricule, nom, poste, service…).</span>
          </li>
          <li>
            <ChoixFichier libelle="Importer le fichier rempli" accept=".xlsx" inputRef={fichier} onFichier={choisir} />
            <span className="note"> {fic ? fic.name : 'Un aperçu s’affiche avant toute modification.'}</span>
          </li>
        </ol>
        {errImport && (
          <p className="champ-erreur" role="alert" style={{ whiteSpace: 'pre-line' }}>
            {errImport}
          </p>
        )}
        {apercu && (
          <div className="apercu-import" role="status">
            <p>
              <strong>{apercu.crees}</strong> à créer · <strong>{apercu.modifies}</strong> à mettre à jour ·{' '}
              <strong>{apercu.anomalies.length}</strong> anomalie(s)
            </p>
            {apercu.anomalies.length > 0 && (
              <ul>
                {apercu.anomalies.slice(0, 10).map((a, i) => (
                  <li key={i}>
                    Ligne {a.ligne} : {a.message}
                  </li>
                ))}
              </ul>
            )}
            <Bouton
              onClick={confirmerImport}
              disabled={apercu.anomalies.length > 0 || apercu.crees + apercu.modifies === 0 || importer.isPending}
            >
              Confirmer l’import
            </Bouton>{' '}
            <Bouton variante="lien" onClick={terminer}>
              Annuler
            </Bouton>
            {apercu.anomalies.length > 0 && <p className="note">Corrigez le fichier puis réimportez-le : rien n’est enregistré tant qu’il y a des anomalies.</p>}
          </div>
        )}
      </Carte>

      <Carte titre={`Liste des employés (${liste.length})`}>
        <div className="filtres">
          <label>
            Rechercher
            <input value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Matricule, nom, service…" />
          </label>
        </div>
        <div className="tableau-defilant">
          <table className="dense">
            <thead>
              <tr>
                <th scope="col">Matricule</th>
                <th scope="col">Nom</th>
                <th scope="col">Poste</th>
                <th scope="col">Contrat</th>
                <th scope="col">Activité</th>
                <th scope="col">Site</th>
                <th scope="col">Service</th>
                <th scope="col">Statut</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {liste.map((s) => (
                <tr key={s.id}>
                  <th scope="row">{s.matricule}</th>
                  <td>{s.nom}</td>
                  <td>{s.poste ?? '—'}</td>
                  <td>{s.type_contrat ?? '—'}</td>
                  <td>{s.activite ?? '—'}</td>
                  <td>{s.site ?? '—'}</td>
                  <td>{s.service ?? '—'}</td>
                  <td>
                    <Badge ton={s.actif ? 'succes' : 'neutre'}>{s.actif ? 'Actif' : 'Inactif'}</Badge>
                  </td>
                  <td>
                    <Bouton
                      variante="lien"
                      onClick={() => {
                        setErr(null)
                        setEdition(s)
                      }}
                    >
                      Modifier
                    </Bouton>
                  </td>
                </tr>
              ))}
              {liste.length === 0 && (
                <tr>
                  <td colSpan={9}>Aucun employé. Ajoutez-en un ou importez le modèle rempli.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Carte>

      <Confirmer
        ouvert={!!edition}
        titre={edition?.id === undefined ? 'Ajouter un employé' : 'Modifier l’employé'}
        confirmer="Enregistrer"
        desactive={!edition?.matricule.trim() || !edition?.nom.trim()}
        onConfirmer={enregistrer}
        onAnnuler={() => setEdition(null)}
      >
        {edition && (
          <div className="formulaire-grille">
            <Champ label="Matricule">
              {(p) => (
                <input {...p} value={edition.matricule} disabled={edition.id !== undefined} onChange={(e) => maj('matricule', e.target.value)} />
              )}
            </Champ>
            <Champ label="Nom">{(p) => <input {...p} value={edition.nom} onChange={(e) => maj('nom', e.target.value)} />}</Champ>
            {CHAMPS.map(([c, lib]) => (
              <Champ key={c} label={lib}>
                {(p) => (
                  <select {...p} value={edition[c] ?? ''} onChange={(e) => maj(c, e.target.value || null)}>
                    <option value="">(non renseigné)</option>
                    {listes.data?.[c].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                )}
              </Champ>
            ))}
            <label className="case">
              <input type="checkbox" checked={edition.actif} onChange={(e) => maj('actif', e.target.checked)} /> Employé actif
            </label>
            {err && (
              <p className="champ-erreur" role="alert">
                {err}
              </p>
            )}
          </div>
        )}
      </Confirmer>
    </>
  )
}
