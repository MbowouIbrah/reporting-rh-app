import { useQueryClient } from '@tanstack/react-query'
import { Check, Copy } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { useAttente } from '../../hooks/useAttente'
import {
  useComptes,
  useCreerCompte,
  useModifierCompte,
  usePerimetres,
  useReferentiel,
  useSupprimerCompte,
  type Compte,
  type ComptePatch,
  type Perimetre,
  type Portee,
} from '../../api/admin'
import { useAuth } from '../../auth/AuthContext'
import AdminNav from '../../components/AdminNav'
import { Panneau } from '../../components/BlocsRapport'
import BoutonReinitialiser from '../../components/BoutonReinitialiser'
import Etat, { etatErreur } from '../../components/Etat'
import { Link } from 'react-router-dom'
import { Bouton, Champ } from '../../components/Kit'
import { MDP_MIN } from '../../lib/connexion'
import { CATALOGUE, GESTION_COMPTES, LECTURE, MODELES, exigeTout } from '../../lib/droits'

const COLONNES = ['Nom', 'Données visibles', 'Statut']
// Mêmes règles que le serveur (admin.py) : messages immédiats, le serveur reste l'autorité.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

const plier = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
const trier = <T extends string | number>(l: T[]) => [...l].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
const basculer = <T extends string | number>(l: T[], v: T) => (l.includes(v) ? l.filter((x) => x !== v) : trier([...l, v]))
const libellePerimetre = (perimetres: Perimetre[] | undefined, id: number) =>
  perimetres?.find((x) => x.id === id)?.libelle ?? `n° ${id}`

/** « Toutes les données », « DPS, Commerce VN », « DPS, Douala +2 ». */
export function resumePortee(p: Portee, perimetres?: Perimetre[]) {
  if (p.tout) return 'Toutes les données'
  const noms = [...p.perimetres.map((id) => libellePerimetre(perimetres, id)), ...p.services, ...p.sites]
  if (!noms.length) return 'Aucune donnée'
  return noms.length <= 2 ? noms.join(', ') : `${noms.slice(0, 2).join(', ')} +${noms.length - 2}`
}

interface Fiche extends Portee {
  nom: string
  email: string
  fonction: string
  password: string
  actif: boolean
  permissions: string[]
}

function ficheDe(c?: Compte): Fiche {
  return {
    nom: c?.nom ?? '',
    email: c?.email ?? '',
    fonction: c?.fonction ?? '',
    password: '',
    actif: c?.actif ?? true,
    permissions: c?.permissions ?? [],
    ...(c?.portee ?? { tout: false, perimetres: [], services: [], sites: [] }),
  }
}

// Ce qui part au serveur : sans « toutes les données », ni listes, ni permissions qui l'exigent.
function droitsDe(f: Fiche): Pick<Compte, 'permissions' | 'portee'> {
  return {
    permissions: f.tout ? f.permissions : f.permissions.filter((c) => !exigeTout(c)),
    portee: f.tout
      ? { tout: true, perimetres: [], services: [], sites: [] }
      : { tout: false, perimetres: f.perimetres, services: f.services, sites: f.sites },
  }
}
const memes = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

// Seuls les champs modifiés partent : un nom corrigé ne touche ni aux droits ni à l'adresse.
function patchDe(f: Fiche, ini: Fiche): Omit<ComptePatch, 'id'> {
  const p: Omit<ComptePatch, 'id'> = {}
  if (f.nom.trim() !== ini.nom) p.nom = f.nom.trim()
  if (f.email.trim().toLowerCase() !== ini.email) p.email = f.email.trim()
  if (f.fonction.trim() !== ini.fonction) p.fonction = f.fonction.trim()
  if (f.actif !== ini.actif) p.actif = f.actif
  if (f.password) p.password = f.password
  if (!memes(droitsDe(f), droitsDe(ini))) Object.assign(p, droitsDe(f))
  return p
}

interface Option<T> {
  valeur: T
  libelle: string
}

interface Toutes {
  perimetres: Perimetre[]
  services: string[] // actifs
  sites: string[]
}

/** Valeurs d'une dimension apportées par les périmètres cochés -> libellé du premier périmètre. */
export function viaPerimetres(choisis: number[], perimetres: Perimetre[], dim: 'service' | 'site') {
  const m = new Map<string, string>()
  for (const p of perimetres) {
    if (!choisis.includes(p.id)) continue
    for (const r of p.regles) if (r.dimension === dim && !m.has(r.valeur)) m.set(r.valeur, p.libelle)
  }
  return m
}

/** Tout coché (directement ou via périmètres) dans une dimension, sans restriction dans l'autre :
 *  c'est « toutes les données » (seule portée qui ouvre CA, marge et import). */
export function normaliser<F extends Portee>(f: F, t: Toutes): F {
  if (f.tout) return f
  const vus = (dim: 'service' | 'site', directs: string[]) => new Set([...directs, ...viaPerimetres(f.perimetres, t.perimetres, dim).keys()])
  const complet = (v: Set<string>, tous: string[]) => tous.length > 0 && tous.every((x) => v.has(x))
  const sv = vus('service', f.services)
  const st = vus('site', f.sites)
  const cs = complet(sv, t.services)
  const ct = complet(st, t.sites)
  return (cs || ct) && (cs || !sv.size) && (ct || !st.size) ? { ...f, tout: true, perimetres: [], services: [], sites: [] } : f
}

/** Cases d'une dimension, repliables ; ouvertes si une case est cochée. « Tout » coche le groupe entier ;
 *  une valeur apportée par un périmètre est cochée et grisée (on décoche le périmètre).
 *  `implicite` : dimension vide alors que l'autre est restreinte, donc non restreinte côté serveur :
 *  tout s'affiche coché, et décocher une valeur garde les autres. */
function Cases<T extends string | number>({
  titre,
  options,
  choisis,
  inclus,
  tout,
  implicite = false,
  desactive,
  onChange,
}: {
  titre: string
  options: Option<T>[]
  choisis: T[]
  inclus?: Map<T, string>
  tout: boolean
  implicite?: boolean
  desactive: boolean
  onChange: (v: T[]) => void
}) {
  if (!options.length) return null
  const ouvert = tout || implicite
  const coche = (v: T) => ouvert || choisis.includes(v) || !!inclus?.has(v)
  const n = options.filter((o) => coche(o.valeur)).length
  const toutCoche = n === options.length
  return (
    <details className="fiche-dimension" open={n > 0} role="group" aria-label={titre}>
      {/* Un clic dans le titre replie le groupe : celui sur « Tout » est capté ici pour seulement cocher ou décocher. */}
      <summary
        onClick={(e) => {
          if (!(e.target as Element).closest('.fiche-case-tout')) return
          e.preventDefault()
          if (!desactive) onChange(toutCoche ? [] : options.map((o) => o.valeur))
        }}
      >
        <span className="fiche-dimension-nom">{titre}</span>
        <label className="fiche-case-tout">
          <input type="checkbox" checked={toutCoche} disabled={desactive} readOnly />
          Tout
        </label>
        <span className={`volet-valeur${toutCoche ? ' volet-valeur-ok' : ''}`}>{`${n} sur ${options.length}`}</span>
      </summary>
      <div className="fiche-cases">
        {options.map((o) => {
          const via = ouvert ? undefined : inclus?.get(o.valeur)
          return (
            <label key={o.valeur}>
              <input
                type="checkbox"
                checked={coche(o.valeur)}
                disabled={desactive || via !== undefined}
                onChange={() => onChange(basculer(ouvert ? options.map((x) => x.valeur) : choisis, o.valeur))}
              />
              <span>
                {o.libelle}
                {via && <small className="fiche-via">{`via ${via}`}</small>}
              </span>
            </label>
          )
        })}
      </div>
    </details>
  )
}

/** Bouton icône qui copie une adresse ; coche 2 s pour confirmer. */
function CopierEmail({ email }: { email: string }) {
  const [copie, setCopie] = useState(false)
  useEffect(() => {
    if (!copie) return
    const t = setTimeout(() => setCopie(false), 2000)
    return () => clearTimeout(t)
  }, [copie])
  const Icone = copie ? Check : Copy
  return (
    <button
      type="button"
      className="bouton-copier"
      aria-label={copie ? 'Adresse copiée' : `Copier l’adresse ${email}`}
      title={copie ? 'Copiée' : 'Copier l’adresse'}
      disabled={!email}
      onClick={() => navigator.clipboard?.writeText(email).then(() => setCopie(true), () => {})}
    >
      <Icone size={14} aria-hidden="true" />
    </button>
  )
}

// Services et sites accordables : les actifs, plus ceux déjà accordés (marqués inactifs).
function useValeurs(dim: 'service' | 'site', choisis: string[]): { options: Option<string>[]; actifs: string[]; erreur: boolean } {
  const q = useReferentiel(dim)
  const valeurs = q.data?.valeurs ?? []
  const actifs = valeurs.filter((v) => v.actif).map((v) => ({ valeur: v.libelle, libelle: v.libelle }))
  const restes = choisis.filter((c) => !actifs.some((a) => a.valeur === c)).map((c) => ({ valeur: c, libelle: `${c} (inactif)` }))
  return { options: [...actifs, ...restes], actifs: actifs.map((a) => a.valeur), erreur: q.isError }
}

function FicheCompte({
  compte,
  soi,
  onCree,
  onEnregistre,
  onFermer,
  onSupprimer,
  onModifie,
}: {
  compte?: Compte
  soi: boolean
  onCree: (c: Compte) => void
  onEnregistre: () => void
  onFermer: () => void
  onSupprimer: (c: Compte) => void
  onModifie: (m: boolean) => void
}) {
  const perimetres = usePerimetres()
  const creer = useCreerCompte()
  const modifier = useModifierCompte()
  const nouveau = compte === undefined
  const qc = useQueryClient()
  const [initiale, setInitiale] = useState<Fiche>(() => ficheDe(compte))
  const [fiche, setFiche] = useState<Fiche>(initiale)
  const [erreurs, setErreurs] = useState<Record<string, string>>({})
  const [erreurApi, setErreurApi] = useState<string | null>(null)
  const services = useValeurs('service', fiche.services)
  const sites = useValeurs('site', fiche.sites)
  const envoi = creer.isPending || modifier.isPending
  const maj = <K extends keyof Fiche>(c: K, v: Fiche[K]) => setFiche((f) => ({ ...f, [c]: v }))
  const toutes: Toutes = { perimetres: perimetres.data ?? [], services: services.actifs, sites: sites.actifs }
  // Depuis « toutes les données », seule la dimension touchée garde ses cases (toutes moins celle décochée).
  const changer = <K extends 'perimetres' | 'services' | 'sites'>(dim: K, v: Fiche[K]) =>
    setFiche((f) => normaliser({ ...f, ...(f.tout && { tout: false, perimetres: [], services: [], sites: [] }), [dim]: v }, toutes))
  const patch = patchDe(fiche, initiale)
  // Comparé sur ce qui partirait : une espace en fin de nom ne compte pas comme une modification.
  const modifie = nouveau ? !memes(fiche, initiale) : Object.keys(patch).length > 0

  useEffect(() => {
    onModifie(modifie)
  }, [modifie, onModifie])
  useEffect(() => () => onModifie(false), [onModifie])

  const appliquerModele = (m: (typeof MODELES)[number]) =>
    setFiche((f) => ({
      ...f,
      fonction: !f.fonction.trim() || MODELES.some((x) => x.fonction === f.fonction) ? m.fonction : f.fonction,
      tout: m.tout,
      perimetres: [],
      services: [],
      sites: [],
      permissions: m.permissions,
    }))

  const envoyer = (e: FormEvent) => {
    e.preventDefault()
    const err: Record<string, string> = {}
    if (!fiche.nom.trim()) err.nom = 'Nom obligatoire'
    if (!EMAIL_RE.test(fiche.email.trim())) err.email = 'Adresse e-mail invalide'
    if ((nouveau || fiche.password) && fiche.password.length < MDP_MIN) err.password = `${MDP_MIN} caractères minimum`
    setErreurs(err)
    setErreurApi(null)
    if (Object.keys(err).length) return
    // mutateAsync : un rappel passé à mutate() serait perdu si la fiche est démontée entre-temps (création).
    const onError = (x: Error) => setErreurApi(x.message)
    if (nouveau) {
      creer
        .mutateAsync({ email: fiche.email.trim(), nom: fiche.nom.trim(), fonction: fiche.fonction.trim(), password: fiche.password, ...droitsDe(fiche) })
        .then(onCree, onError)
      return
    }
    modifier.mutateAsync({ id: compte.id, ...patch }).then((c) => {
      // La fiche repart de la réponse du serveur (mot de passe vidé, valeurs normalisées).
      setInitiale(ficheDe(c))
      setFiche(ficheDe(c))
      if (soi) qc.invalidateQueries({ queryKey: ['me'] }) // nom et fonction du menu profil
      onEnregistre()
    }, onError)
  }

  // Dimension vide alors que l'autre est restreinte : non restreinte (« service X sur tous les sites »).
  const viaServices = viaPerimetres(fiche.perimetres, toutes.perimetres, 'service')
  const viaSites = viaPerimetres(fiche.perimetres, toutes.perimetres, 'site')
  const aServices = fiche.services.length > 0 || viaServices.size > 0
  const aSites = fiche.sites.length > 0 || viaSites.size > 0
  const rienVisible = !fiche.tout && !fiche.perimetres.length && !fiche.services.length && !fiche.sites.length
  const raison = (code: string) => {
    if (code === LECTURE) return 'Toujours accordée'
    if (soi && code === GESTION_COMPTES) return 'Vous ne pouvez pas retirer ce droit à votre propre compte'
    if (exigeTout(code) && !fiche.tout) return 'Exige toutes les données (« Tout » coché)'
    return null
  }

  return (
    <Panneau titre={nouveau ? 'Nouveau compte' : compte.nom} className="fiche-compte">
      <form onSubmit={envoyer} noValidate>
        {nouveau && (
          <div className="fiche-modeles" role="group" aria-label="Modèles">
            <span>Partir d’un modèle :</span>
            {MODELES.map((m) => (
              <Bouton key={m.code} variante="secondaire" onClick={() => appliquerModele(m)}>{m.fonction}</Bouton>
            ))}
          </div>
        )}
        <fieldset>
          <legend>Identité</legend>
          <div className="admin-form">
            <Champ label="Nom" erreur={erreurs.nom}>
              {(p) => <input {...p} value={fiche.nom} onChange={(e) => maj('nom', e.target.value)} />}
            </Champ>
            <Champ label="Adresse e-mail" erreur={erreurs.email}>
              {(p) => (
                <span className="champ-copie">
                  <input {...p} type="email" autoComplete="off" value={fiche.email} onChange={(e) => maj('email', e.target.value)} />
                  <CopierEmail email={fiche.email.trim()} />
                </span>
              )}
            </Champ>
            <Champ label="Fonction">
              {(p) => <input {...p} placeholder="ex. DRH, Directeur commercial VN" value={fiche.fonction} onChange={(e) => maj('fonction', e.target.value)} />}
            </Champ>
            {soi ? (
              <div className="field">
                <Link className="btn-link" to="/changer-mot-de-passe?next=/admin/utilisateurs">Changer mon mot de passe</Link>
              </div>
            ) : (
              <Champ label={nouveau ? 'Mot de passe' : 'Nouveau mot de passe'} erreur={erreurs.password}>
                {(p) => (
                  <>
                    <input {...p} type="password" autoComplete="new-password" value={fiche.password} onChange={(e) => maj('password', e.target.value)} />
                    <p className="note">{nouveau ? 'Provisoire : à changer par l’utilisateur.' : 'Vide : inchangé. Sinon provisoire : à changer par l’utilisateur.'}</p>
                  </>
                )}
              </Champ>
            )}
            {!nouveau && (
              <label className="admin-case">
                <input type="checkbox" checked={fiche.actif} disabled={soi} onChange={(e) => maj('actif', e.target.checked)} />
                Compte actif
              </label>
            )}
            <p className="admin-contexte">La fonction est un libellé affiché ; elle ne donne aucun droit.</p>
          </div>
        </fieldset>

        <fieldset>
          <legend>Données visibles</legend>
          {soi && <p className="note">Votre propre accès aux données ne se modifie pas ici (évite de perdre l’accès).</p>}
          {perimetres.isError && <p className="champ-erreur" role="alert">Liste des périmètres indisponible</p>}
          <Cases
            titre="Périmètres"
            options={toutes.perimetres.map((x) => ({ valeur: x.id, libelle: x.libelle }))}
            choisis={fiche.perimetres}
            tout={fiche.tout}
            desactive={soi}
            onChange={(v) => changer('perimetres', v)}
          />
          {(services.erreur || sites.erreur) && <p className="champ-erreur" role="alert">Liste des services ou des sites indisponible</p>}
          <Cases
            titre="Services"
            options={services.options}
            choisis={fiche.services}
            inclus={viaServices}
            tout={fiche.tout}
            implicite={aSites && !aServices}
            desactive={soi}
            onChange={(v) => changer('services', v)}
          />
          <Cases
            titre="Sites"
            options={sites.options}
            choisis={fiche.sites}
            inclus={viaSites}
            tout={fiche.tout}
            implicite={aServices && !aSites}
            desactive={soi}
            onChange={(v) => changer('sites', v)}
          />
          <p className="note">
            {fiche.tout
              ? 'Toutes les données : ce compte voit toute l’entreprise.'
              : rienVisible
                ? 'Aucune donnée cochée : ce compte ne verra aucun rapport.'
                : 'Un service et un site cochés ensemble : seulement ce service sur ce site.'}
          </p>
        </fieldset>

        <fieldset>
          <legend>Permissions</legend>
          <ul className="fiche-permissions">
            {CATALOGUE.map((p) => {
              const r = raison(p.code)
              const coche = p.code === LECTURE || (fiche.permissions.includes(p.code) && (fiche.tout || !p.porteeTout))
              return (
                <li key={p.code}>
                  <label title={r ?? undefined}>
                    <input type="checkbox" checked={coche} disabled={r !== null} onChange={() => maj('permissions', basculer(fiche.permissions, p.code))} />
                    <strong>{p.libelle}</strong>
                    <small>{p.explication}</small>
                  </label>
                </li>
              )
            })}
          </ul>
          {!fiche.tout && <p className="note">Cases grisées : cochez « Tout » dans les données visibles pour les accorder.</p>}
        </fieldset>

        {erreurApi && <p className="champ-erreur fiche-erreur" role="alert">{erreurApi}</p>}
        {(nouveau || modifie) && (
          <div className="fiche-barre">
            <button type="submit" className="bouton bouton-primaire" disabled={envoi}>
              {nouveau ? 'Créer le compte' : 'Enregistrer'}
            </button>
            <Bouton
              variante="secondaire"
              disabled={envoi}
              onClick={() => {
                if (nouveau) return onFermer()
                setFiche(initiale)
                setErreurs({})
                setErreurApi(null)
              }}
            >
              Annuler
            </Bouton>
          </div>
        )}
        {!nouveau && !modifie && !soi && (
          <div className="fiche-barre fiche-barre-discrete">
            <Bouton onClick={() => onSupprimer(compte)}>Supprimer ce compte</Bouton>
          </div>
        )}
      </form>
    </Panneau>
  )
}

type Selection = number | 'nouveau' | null

export default function Utilisateurs() {
  const { me } = useAuth()
  const q = useComptes()
  const [premier] = useAttente(q.isLoading)
  const perimetres = usePerimetres()
  const supprimer = useSupprimerCompte()
  const [recherche, setRecherche] = useState('')
  const [selection, setSelection] = useState<Selection>(null)
  const [enCours, setEnCours] = useState(false)
  const [aSupprimer, setASupprimer] = useState<Compte | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null)

  const mots = plier(recherche.trim())
  const liste = (q.data ?? []).filter((c) => !mots || plier(`${c.nom} ${c.email} ${c.fonction}`).includes(mots))
  const choisi = typeof selection === 'number' ? q.data?.find((c) => c.id === selection) : undefined
  // Une fiche modifiée ne se quitte pas sans Enregistrer ou Annuler (pas de perte silencieuse).
  const choisir = (s: Selection) => {
    if (enCours && s !== selection) {
      setMessage({ ok: false, texte: 'Enregistrez ou annulez les modifications en cours avant de changer de compte.' })
      return
    }
    setMessage(null)
    setASupprimer(null)
    setSelection(s)
  }
  const confirmerSuppression = () => {
    if (!aSupprimer) return
    setMessage(null)
    supprimer.mutate(aSupprimer.id, {
      onSuccess: () => {
        setSelection(null)
        setMessage({ ok: true, texte: `Compte de ${aSupprimer.nom} supprimé.` })
        setASupprimer(null)
      },
      onError: (e) => {
        setASupprimer(null)
        setMessage({ ok: false, texte: e.message })
      },
    })
  }

  return (
    <section className="page-ecran rapport-excel admin-excel">
      <AdminNav />
      <div className="filtres" role="group" aria-label="Recherche">
        <label>
          Recherche
          <input type="search" placeholder="Nom, adresse ou fonction" value={recherche} onChange={(e) => setRecherche(e.target.value)} />
        </label>
        <BoutonReinitialiser actif={!!recherche} onClick={() => setRecherche('')} libelle="Effacer la recherche" />
        <Bouton className="admin-ajout" onClick={() => choisir('nouveau')}>Nouveau compte</Bouton>
      </div>
      {q.isError && !premier && <Etat type={etatErreur(q.error)} onRetry={() => q.refetch()} />}
      {premier && <Etat type="chargement" colonnes={COLONNES} lignes={6} />}
      {q.data && !premier && (
        <>
          <p className="bandeau">
            <span className="val">{`${liste.length} utilisateur${liste.length > 1 ? 's' : ''}`}</span>
          </p>
          {message && <p className={message.ok ? 'bandeau' : 'bandeau ko'} role={message.ok ? 'status' : 'alert'}>{message.texte}</p>}
          <div className="comptes-duo">
            {liste.length === 0 ? (
              <Etat type="vide" titre={q.data.length ? 'Aucun utilisateur ne correspond à la recherche' : 'Aucun utilisateur'} aide="" />
            ) : (
              <Panneau titre="Utilisateurs" className="comptes-liste">
                <table className="dense">
                  <thead>
                    <tr>{COLONNES.map((c) => <th key={c} scope="col">{c}</th>)}</tr>
                  </thead>
                  <tbody>
                    {liste.map((c) => (
                      <tr key={c.id} className={c.id === aSupprimer?.id ? 'a-supprimer' : undefined}>
                        <th scope="row">
                          <button type="button" className="ligne-compte" aria-current={c.id === selection ? 'true' : undefined} onClick={() => choisir(c.id)}>
                            {c.nom}
                            {c.id === me?.id && <span className="note"> (vous)</span>}
                          </button>
                          {c.fonction && <span className="fonction">{c.fonction}</span>}
                        </th>
                        <td>{resumePortee(c.portee, perimetres.data)}</td>
                        <td><span className={c.actif ? 'statut statut-ok' : 'statut'}>{c.actif ? 'Actif' : 'Inactif'}</span>{c.doit_changer_mdp && <>{' '}<span className="statut">Provisoire</span></>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panneau>
            )}
            {aSupprimer ? (
              <Panneau titre="Supprimer le compte ?" className="fiche-compte fiche-suppression">
                <div className="suppression-carte" role="alertdialog" aria-labelledby="suppression-nom">
                  <p className="suppression-titre">Suppression définitive</p>
                  <p id="suppression-nom" className="suppression-nom">{aSupprimer.nom}</p>
                  <p className="suppression-email">{aSupprimer.email}</p>
                  <p>Ce compte ne pourra plus se connecter.</p>
                  <p className="note">Pour garder une trace, préférez décocher « Compte actif ».</p>
                  <div className="suppression-actions">
                    <Bouton variante="secondaire" autoFocus onClick={() => setASupprimer(null)}>Annuler</Bouton>
                    <Bouton disabled={supprimer.isPending} onClick={confirmerSuppression}>Supprimer le compte</Bouton>
                  </div>
                </div>
              </Panneau>
            ) : selection === 'nouveau' || choisi ? (
              <FicheCompte
                // Par identifiant : un rechargement de la liste n'efface pas une saisie en cours.
                key={choisi?.id ?? 'nouveau'}
                compte={choisi}
                soi={choisi?.id === me?.id}
                onCree={(c) => {
                  setEnCours(false)
                  setSelection(c.id)
                  setMessage({ ok: true, texte: `Compte de ${c.nom} créé.` })
                }}
                onEnregistre={() => setMessage({ ok: true, texte: 'Modifications enregistrées.' })}
                onFermer={() => setSelection(null)}
                onSupprimer={setASupprimer}
                onModifie={setEnCours}
              />
            ) : (
              <p className="note comptes-invite">Choisissez un compte dans la liste pour voir et modifier ses droits.</p>
            )}
          </div>
        </>
      )}
    </section>
  )
}
