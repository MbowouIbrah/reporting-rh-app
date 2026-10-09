import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ClipboardEvent, FocusEvent, KeyboardEvent, MouseEvent } from 'react'
import {
  ATTRIBUTS, creerLotSaisie, verifier,
  type AnomalieSaisie, type LigneSaisie, type Lot, type Preparation, type Verification,
} from '../../../api/saisie'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import BoutonReinitialiser from '../../../components/BoutonReinitialiser'
import { Bouton } from '../../../components/Kit'
import { largeurEntete, matriculeAffiche, MOIS, valeurBrute } from '../../../lib/format'
import { coller, estMontant, lireTSV, type Ligne } from '../../../lib/grille'
import BarreParcours from './BarreParcours'
import { aSaisie, cleBrouillon, ecrireBrouillon, effacerBrouillon } from './brouillon'
import Etapes from './Etapes'
import LienModele from './LienModele'
import ListeChoix, { ID_LISTE, idOption } from './ListeChoix'

const TITRES: Record<string, string> = {
  matricule: 'MATRICULE', nom: 'Noms', poste: 'Poste', type_contrat: 'Type Contrat',
  activite: 'Activité', site: 'Site', service: 'Service',
}
// Colonne d'une anomalie serveur -> clé de colonne de la grille.
const COLONNE_ANO: Record<string, string> = {
  ...Object.fromEntries(Object.entries(TITRES).map(([k, v]) => [v, k])),
  'ANNÉE+MOIS+MATRICULE': 'matricule',
}
const R = 'r:'
const HISTORIQUE = 50

let compteur = 0
export const nouvelId = () => `n${Date.now().toString(36)}${(compteur++).toString(36)}`

/** Ligne vide pour un employé non répertorié. */
export const ligneVide = (rubriques: string[]): Ligne => ({
  _id: nouvelId(), matricule: '', nom: '', ...Object.fromEntries(ATTRIBUTS.map((a) => [a, ''])),
  ...Object.fromEntries(rubriques.map((r) => [R + r, ''])),
})

/** Lignes de départ : employés cochés, attributs repris, montants du mois s'ils existent déjà. */
export function lignesDepart(prepa: Preparation, matricules: string[]): Ligne[] {
  const par = new Map(prepa.salaries.map((s) => [s.matricule, s]))
  return matricules.flatMap((m) => {
    const s = par.get(m)
    if (!s) return []
    return [{
      _id: s.matricule, _connu: '1', matricule: s.matricule, nom: s.nom,
      ...Object.fromEntries(ATTRIBUTS.map((a) => [a, s.attributs[a] ?? ''])),
      ...Object.fromEntries(prepa.rubriques.map((r) => [R + r.libelle, valeurBrute(s.montants[r.libelle])])),
    }]
  })
}

/** Lignes de la grille pour une sélection : saisie en cours gardée sauf les décochés, nouveaux cochés ajoutés. */
export function lignesSelection(prepa: Preparation, matricules: string[], enCours: Ligne[] = []): Ligne[] {
  const garde = enCours.filter((l) => !l._connu || matricules.includes(l.matricule))
  const deja = new Set(garde.map((l) => l.matricule))
  return [...garde, ...lignesDepart(prepa, matricules.filter((m) => !deja.has(m)))]
}

const aMontant = (l: Ligne) => Object.entries(l).some(([k, v]) => k.startsWith(R) && v.trim() !== '')
export const versApi = (l: Ligne, rubriques: string[]): LigneSaisie => ({
  matricule: l.matricule.trim(), nom: l.nom.trim() || null,
  ...(Object.fromEntries(ATTRIBUTS.map((a) => [a, l[a]?.trim() || null])) as Pick<LigneSaisie, (typeof ATTRIBUTS)[number]>),
  montants: Object.fromEntries(rubriques.map((r) => [r, l[R + r]?.trim() || null])),
})

type AnosLigne = Record<string, AnomalieSaisie>
interface Colonne { cle: string; titre: string; montant: boolean; exclu: boolean; liste?: boolean }
/** Liste de valeurs ouverte sous une cellule : r = position affichée, actif = option en surbrillance (-1 : aucune). */
interface Menu { r: number; c: number; actif: number }
interface Tri { cle: string; sens: 1 | -1 }

/** Filtres au-dessus de la grille : remplir service par service, contrat par contrat… */
const FILTRES = ['service', 'type_contrat', 'site'] as const
type Filtres = Partial<Record<(typeof FILTRES)[number] | 'q', string>>

const sansAccents = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
// Ordre d'affichage seulement : le montant reste du texte, jamais converti pour un calcul.
const enNombre = (s: string) => Number(s.replace(/[\s  ]/g, '').replace(',', '.'))

/**
 * Lignes affichées (index dans `lignes`), filtrées puis triées. Une ligne sans nom ni matricule (en cours
 * d'ajout) reste visible quelle que soit la recherche. Les cellules vides vont en fin de liste.
 */
export function ordreAffiche(lignes: Ligne[], filtres: Filtres, tri: Tri | null, montant: (cle: string) => boolean): number[] {
  const q = sansAccents(filtres.q?.trim() ?? '')
  const idx = lignes.flatMap((l, i) => {
    if (FILTRES.some((f) => filtres[f] && (l[f] ?? '') !== filtres[f])) return []
    if (q && (l.nom || l.matricule) && !sansAccents(`${l.nom} ${l.matricule}`).includes(q)) return []
    return [i]
  })
  if (!tri) return idx
  const num = montant(tri.cle)
  return idx.sort((a, b) => {
    const va = (lignes[a][tri.cle] ?? '').trim()
    const vb = (lignes[b][tri.cle] ?? '').trim()
    if (!va || !vb) return va ? -1 : vb ? 1 : a - b
    const d = num ? enNombre(va) - enNombre(vb) : va.localeCompare(vb, 'fr', { numeric: true })
    return (d || a - b) * (d ? tri.sens : 1)
  })
}

interface Props {
  prepa: Preparation
  lignesInitiales: Ligne[]
  brouillonId: string
  onRetour: () => void
  onLot: (lot: Lot) => void
}

export default function GrilleSaisie({ prepa, lignesInitiales, brouillonId, onRetour, onLot }: Props) {
  const { annee, mois } = prepa
  const [lignes, setLignes] = useState<Ligne[]>(lignesInitiales)
  const [verif, setVerif] = useState<{ ids: string[]; v: Verification } | null>(null)
  const [enCours, setEnCours] = useState(false)
  const [echecVerif, setEchecVerif] = useState<string | null>(null)
  const [envoiEnCours, setEnvoiEnCours] = useState(false)
  const [envoi, setEnvoi] = useState<string | null>(null)
  const [focus, setFocus] = useState<{ r: number; c: number } | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const table = useRef<HTMLTableElement>(null)
  const courant = useRef(lignes)
  courant.current = lignes
  const historique = useRef<Ligne[][]>([])
  const auFocus = useRef<{ valeur: string; lignes: Ligne[] } | null>(null)

  const rubriques = useMemo(() => prepa.rubriques.map((r) => r.libelle), [prepa])
  const colonnes: Colonne[] = useMemo(() => {
    const exclues = new Set(prepa.exclues)
    const rub = [...rubriques.filter((r) => !exclues.has(r)), ...rubriques.filter((r) => exclues.has(r))]
    // Montants juste après le nom : c'est ce qu'on saisit. Poste à Service, déjà remplis, en fin de ligne.
    const texte = (cle: string, liste?: boolean) => ({ cle, titre: TITRES[cle], montant: false, exclu: false, liste })
    return [
      texte('matricule'), texte('nom'),
      ...rub.map((r) => ({ cle: R + r, titre: r, montant: true, exclu: exclues.has(r) })),
      ...ATTRIBUTS.map((a) => texte(a, true)),
    ]
  }, [prepa, rubriques])
  const cles = useMemo(() => colonnes.map((c) => c.cle), [colonnes])

  // Lignes affichées : calculées quand le tri, les filtres ou la liste des lignes changent, pas à chaque
  // frappe (une ligne ne saute pas ailleurs pendant qu'on la remplit). data-r = position affichée.
  const [tri, setTri] = useState<Tri | null>(null)
  const [filtres, setFiltres] = useState<Filtres>({})
  const ids = lignes.map((l) => l._id).join('|')
  const ordre = useMemo(
    () => ordreAffiche(lignes, filtres, tri, (cle) => cle.startsWith(R)),
    [ids, tri, filtres],
  )
  const ordreRef = useRef(ordre)
  ordreRef.current = ordre
  const valeursFiltre = useMemo(
    () => Object.fromEntries(FILTRES.map((f) => [f, [...new Set(lignes.map((l) => l[f]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'))])),
    [ids],
  ) as Record<(typeof FILTRES)[number], string[]>
  const filtre = FILTRES.some((f) => filtres[f]) || !!filtres.q?.trim()
  // Une ligne ajoutée pendant un filtrage hérite du service, du contrat… filtrés : elle reste visible.
  const nouvelle = useCallback(
    () => ({ ...ligneVide(rubriques), ...Object.fromEntries(FILTRES.filter((f) => filtres[f]).map((f) => [f, filtres[f]!])) }),
    [rubriques, filtres],
  )
  const trier = (cle: string) =>
    setTri((t) => (t?.cle !== cle ? { cle, sens: 1 } : t.sens === 1 ? { cle, sens: -1 } : null))

  const modifiable = useCallback((l: Ligne, cle: string) => !(l._connu && (cle === 'matricule' || cle === 'nom')), [])

  const changer = useCallback((next: Ligne[], memoriser = true) => {
    if (memoriser) historique.current = [...historique.current.slice(-HISTORIQUE + 1), courant.current]
    setLignes(next)
  }, [])

  // Brouillon local : survit à un rechargement, effacé une fois la saisie enregistrée.
  useEffect(() => {
    const cle = cleBrouillon(annee, mois)
    if (aSaisie(lignes)) ecrireBrouillon(cle, { id: brouillonId, lignes })
    else effacerBrouillon(cle)
  }, [annee, mois, brouillonId, lignes])

  // Vérification serveur 600 ms après la dernière frappe : anomalies par cellule et TOTAL de chaque ligne.
  const envoyees = useMemo(() => lignes.filter(aMontant), [lignes])
  useEffect(() => {
    if (!envoyees.length) { setVerif(null); setEchecVerif(null); setEnCours(false); return }
    const ctrl = new AbortController()
    setEnCours(true)
    const t = setTimeout(() => {
      verifier(annee, mois, envoyees.map((l) => versApi(l, rubriques)), ctrl.signal)
        .then((v) => { setVerif({ ids: envoyees.map((l) => l._id), v }); setEchecVerif(null) })
        // Échec : l'ancien résultat ne vaut plus pour ce contenu, l'enregistrement reste bloqué.
        .catch((e) => {
          if (ctrl.signal.aborted) return
          setVerif(null)
          setEchecVerif(`Vérification impossible : ${e instanceof Error ? e.message : 'erreur inconnue'}.`)
        })
        .finally(() => { if (!ctrl.signal.aborted) setEnCours(false) })
    }, 600)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [annee, mois, envoyees, rubriques])

  const { parLigne, totaux, nbBloquants, nbAvert } = useMemo(() => {
    const parLigne = new Map<string, AnosLigne>()
    const totaux = new Map<string, string>()
    let nbBloquants = 0
    let nbAvert = 0
    if (verif) {
      verif.v.totaux.forEach((t, i) => t && totaux.set(verif.ids[i], t.total))
      for (const a of verif.v.anomalies) {
        const id = verif.ids[a.ligne]
        if (id === undefined) continue
        const cle = a.colonne ? (COLONNE_ANO[a.colonne] ?? R + a.colonne) : 'matricule'
        const m = parLigne.get(id) ?? {}
        if (!m[cle] || (a.gravite === 'bloquant' && m[cle].gravite !== 'bloquant')) m[cle] = a
        parLigne.set(id, m)
        if (a.gravite === 'bloquant') nbBloquants++
        else nbAvert++
      }
    }
    return { parLigne, totaux, nbBloquants, nbAvert }
  }, [verif])

  const cellule = (r: number, c: number) =>
    table.current?.querySelector<HTMLInputElement>(`input[data-r="${r}"][data-c="${c}"]`) ?? null
  const aller = (r: number, c: number) => {
    const el = cellule(Math.max(0, r), Math.max(0, Math.min(c, cles.length - 1)))
    if (el) { el.focus(); el.select() }
  }

  /** r : position affichée, convertie en index réel dans `lignes`. */
  const ecrire = useCallback((r: number, cle: string, v: string, memoriser = false) => {
    const i = ordreRef.current[r]
    const next = courant.current.slice()
    next[i] = { ...next[i], [cle]: v }
    changer(next, memoriser)
  }, [changer])

  const onCellule = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const { r, c } = e.target.dataset
    ecrire(Number(r), cles[Number(c)], e.target.value)
    // Frappe dans Poste, Site, Service… : la liste propose les valeurs connues qui correspondent.
    if (colonnes[Number(c)].liste) setMenu({ r: Number(r), c: Number(c), actif: -1 })
  }, [cles, colonnes, ecrire])

  const optionsMenu = useMemo(() => {
    if (!menu) return []
    const col = colonnes[menu.c]
    if (!col.liste) return []
    const toutes = prepa.referentiels[col.cle as (typeof ATTRIBUTS)[number]] ?? []
    const v = sansAccents((lignes[ordre[menu.r]]?.[col.cle] ?? '').trim())
    // Cellule vide ou déjà sur une valeur connue : toutes les valeurs, pour pouvoir en changer.
    if (!v || toutes.some((o) => sansAccents(o) === v)) return toutes
    return toutes.filter((o) => sansAccents(o).includes(v))
  }, [menu, colonnes, prepa, lignes, ordre])
  const choisir = (v: string) => {
    if (!menu) return
    ecrire(menu.r, cles[menu.c], v)
    setMenu(null)
  }

  const pos = (el: EventTarget) => {
    const d = (el as HTMLElement).dataset
    return d?.r === undefined ? null : { r: Number(d.r), c: Number(d.c), el: el as HTMLInputElement }
  }

  const onFocus = (e: FocusEvent<HTMLTableElement>) => {
    const p = pos(e.target)
    if (!p) return
    setFocus({ r: p.r, c: p.c })
    auFocus.current = { valeur: p.el.value, lignes: courant.current }
  }
  const onBlur = (e: FocusEvent<HTMLTableElement>) => {
    const p = pos(e.target)
    const f = auFocus.current
    if (p && f && p.el.value !== f.valeur) historique.current = [...historique.current.slice(-HISTORIQUE + 1), f.lignes]
    auFocus.current = null
    setMenu(null)
  }
  // Clic dans une cellule à liste : ouvre ou referme les valeurs proposées.
  const onClick = (e: MouseEvent<HTMLTableElement>) => {
    const p = pos(e.target)
    if (!p || !colonnes[p.c].liste) return
    setMenu((m) => (m?.r === p.r && m.c === p.c ? null : { r: p.r, c: p.c, actif: -1 }))
  }

  const onPaste = (e: ClipboardEvent<HTMLTableElement>) => {
    const p = pos(e.target)
    if (!p) return
    e.preventDefault()
    const bloc = lireTSV(e.clipboardData.getData('text/plain'))
    if (!bloc.length) return
    // Collage sur les lignes affichées, dans leur ordre ; les lignes créées vont en fin de liste.
    const o = ordreRef.current
    const colle = coller(o.map((i) => courant.current[i]), p.r, p.c, bloc, cles, modifiable, nouvelle)
    const next = courant.current.slice()
    o.forEach((i, k) => { next[i] = colle[k] })
    changer([...next, ...colle.slice(o.length)])
    auFocus.current = null
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTableElement>) => {
    const p = pos(e.target)
    if (!p) return
    const { r, c, el } = p
    // Liste ouverte : les flèches parcourent les valeurs, Entrée retient celle en surbrillance, Échap ferme.
    const n = optionsMenu.length
    if (menu?.r === r && menu.c === c && n) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const pas = e.key === 'ArrowDown' ? 1 : -1
        setMenu({ ...menu, actif: menu.actif < 0 && pas < 0 ? n - 1 : (menu.actif + pas + n) % n })
        return
      }
      if (e.key === 'Enter' && menu.actif >= 0) {
        e.preventDefault()
        choisir(optionsMenu[menu.actif])
        return
      }
      if (e.key === 'Escape') {
        setMenu(null)
        return
      }
    } else if (e.altKey && e.key === 'ArrowDown' && colonnes[c].liste) {
      e.preventDefault()
      setMenu({ r, c, actif: -1 })
      return
    }
    const ctrl = e.ctrlKey || e.metaKey
    let cible: [number, number] | null = null
    if (e.key === 'Enter') cible = [e.shiftKey ? r - 1 : r + 1, c]
    else if (e.key === 'ArrowDown' && !e.altKey) cible = [r + 1, c]
    else if (e.key === 'ArrowUp' && !e.altKey) cible = [r - 1, c]
    else if (e.key === 'ArrowLeft' && el.selectionStart === 0 && el.selectionEnd === 0) cible = [r, c - 1]
    else if (e.key === 'ArrowRight' && el.selectionStart === el.value.length) cible = [r, c + 1]
    else if (ctrl && e.key.toLowerCase() === 'd' && r > 0) {
      e.preventDefault()
      const [dessus, ici] = [courant.current[ordreRef.current[r - 1]], courant.current[ordreRef.current[r]]]
      if (modifiable(ici, cles[c])) ecrire(r, cles[c], dessus[cles[c]] ?? '', true)
      return
    } else if (ctrl && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      const f = auFocus.current
      if (f && el.value !== f.valeur) ecrire(r, cles[c], f.valeur)
      else if (historique.current.length) setLignes(historique.current.pop()!)
      if (auFocus.current) auFocus.current = { valeur: el.value, lignes: courant.current }
      return
    } else if (e.key === 'Escape' && auFocus.current) {
      ecrire(r, cles[c], auFocus.current.valeur)
      return
    }
    if (cible) {
      e.preventDefault()
      aller(cible[0], cible[1])
    }
  }

  const ajouter = () => {
    changer([...courant.current, nouvelle()])
    setTimeout(() => aller(ordreRef.current.length - 1, 0))
  }
  const retirer = useCallback((r: number) => {
    const i = ordreRef.current[r]
    changer(courant.current.filter((_, k) => k !== i))
  }, [changer])

  const erreurDans = (o: number[]) => {
    for (const [pos, i] of o.entries()) {
      const m = parLigne.get(courant.current[i]._id)
      const cle = m && cles.find((k) => m[k]?.gravite === 'bloquant')
      if (cle) return [pos, cles.indexOf(cle)] as const
    }
    return null
  }
  const premiereErreur = () => {
    const ici = erreurDans(ordre)
    if (ici) return aller(...ici)
    // Erreur sur une ligne masquée par les filtres : on les retire pour l'atteindre.
    setFiltres({})
    setTimeout(() => { const p = erreurDans(ordreRef.current); if (p) aller(...p) })
  }

  const enregistrer = async () => {
    setEnvoi(null)
    setEnvoiEnCours(true)
    try {
      const lot = await creerLotSaisie(brouillonId, annee, mois, envoyees.map((l) => versApi(l, rubriques)))
      if (lot.statut === 'pret') return onLot(lot)
      setEnvoi('La saisie contient des erreurs : corrigez les cellules en rouge.')
    } catch (err) {
      setEnvoi(err instanceof Error ? err.message : 'Enregistrement impossible.')
    }
    setEnvoiEnCours(false)
  }

  const ignorees = lignes.length - envoyees.length
  const ligneFocus = focus ? lignes[ordre[focus.r]] : undefined
  const anoFocus = ligneFocus ? parLigne.get(ligneFocus._id)?.[cles[focus!.c]] : undefined
  const pret = envoyees.length > 0 && !enCours && !envoiEnCours && verif !== null && nbBloquants === 0
  const ancreMenu = menu && optionsMenu.length ? cellule(menu.r, menu.c) : null

  return (
    <section className="page-ecran rapport-excel donnees-excel saisie-excel">
      <BarreParcours libelle="Employés concernés" onRetour={onRetour}>
        <Etapes parcours="grille" actuelle={2} />
      </BarreParcours>
      <h2 className="bandeau-titre">SAISIE DES MONTANTS — {MOIS[mois - 1].toUpperCase()} {annee}</h2>
      <div className="filtres" role="group" aria-label="Filtres de la grille">
        <label>
          Rechercher
          <input type="search" value={filtres.q ?? ''} placeholder="Nom ou matricule"
            onChange={(e) => setFiltres((f) => ({ ...f, q: e.target.value }))} />
        </label>
        {FILTRES.map((k) => (
          <label key={k}>
            {TITRES[k]}
            <select value={filtres[k] ?? ''} onChange={(e) => setFiltres((f) => ({ ...f, [k]: e.target.value }))}>
              <option value="">Tous</option>
              {valeursFiltre[k].map((v) => <option key={v}>{v}</option>)}
            </select>
          </label>
        ))}
        <BoutonReinitialiser actif={filtre} onClick={() => setFiltres({})} />
        <span className="saisie-compte" role="status">
          {filtre ? `${ordre.length} ligne${ordre.length > 1 ? 's' : ''} affichée${ordre.length > 1 ? 's' : ''} sur ${lignes.length}` : `${lignes.length} ligne${lignes.length > 1 ? 's' : ''}`}
        </span>
      </div>
      <div className="panneau">
        <div className="panneau-corps" role="region" aria-label="Grille de saisie"
          title="Entrée : ligne suivante · Tab : colonne suivante · Ctrl+V : coller depuis Excel · Ctrl+D : recopier la cellule du dessus · Ctrl+Z : annuler">
          <table className="dense" ref={table} onFocus={onFocus} onBlur={onBlur} onPaste={onPaste} onKeyDown={onKeyDown} onClick={onClick}>
            <thead>
              <tr>
                <th scope="col" className="fige fige-1"><span className="sr-only">Ligne</span></th>
                {colonnes.map((c, j) => {
                  const sens = tri?.cle === c.cle ? tri.sens : 0
                  return (
                    <th key={c.cle} scope="col"
                      className={[j < 2 && `fige fige-${j + 2}`, c.montant && 'num', c.exclu && 'exclu'].filter(Boolean).join(' ') || undefined}
                      style={j < 2 ? undefined : { minWidth: Math.max(largeurEntete(c.titre) + 18, c.montant ? 96 : 150) }}
                      aria-sort={sens === 1 ? 'ascending' : sens === -1 ? 'descending' : undefined}>
                      <button type="button" className="tri" onClick={() => trier(c.cle)} title={`Trier par ${c.titre}`}>
                        <span>{c.titre}</span>
                        {sens === 1 ? <ArrowUp aria-hidden="true" size={13} /> : sens === -1 ? <ArrowDown aria-hidden="true" size={13} />
                          : <ArrowUpDown aria-hidden="true" size={13} className="tri-inactif" />}
                      </button>
                    </th>
                  )
                })}
                <th scope="col" className="num total">TOTAL CHARGES (FCFA)</th>
              </tr>
            </thead>
            <tbody>
              {ordre.map((i, r) => {
                const l = lignes[i]
                return (
                  <Rangee key={l._id} ligne={l} r={r} colonnes={colonnes} anos={parLigne.get(l._id)}
                    total={totaux.get(l._id)} ignoree={!aMontant(l)} onCellule={onCellule} onRetirer={retirer}
                    menu={menu?.r === r && optionsMenu.length ? menu : undefined} />
                )
              })}
              {ordre.length === 0 && (
                <tr><td colSpan={colonnes.length + 2} className="etat">Aucune ligne ne correspond aux filtres.</td></tr>
              )}
            </tbody>
          </table>
          {ancreMenu && (
            <ListeChoix ancre={ancreMenu} options={optionsMenu} actif={menu!.actif}
              valeur={lignes[ordre[menu!.r]]?.[cles[menu!.c]] ?? ''} onChoisir={choisir}
              onSurvol={(i) => setMenu((m) => m && { ...m, actif: i })} />
          )}
        </div>
        <div className="saisie-ajout">
          <button type="button" className="bouton bouton-lien" onClick={ajouter}>+ Ajouter une ligne</button>
        </div>
      </div>
      <p className={`bandeau ${nbBloquants || envoi || echecVerif ? 'ko' : 'ok'}`} role="status">
        <span>{envoyees.length} ligne{envoyees.length > 1 ? 's' : ''} à enregistrer</span>
        {ignorees > 0 && <span className="note">{ignorees} sans montant, ignorée{ignorees > 1 ? 's' : ''}</span>}
        {enCours ? <span>Vérification…</span> : verif && (
          nbBloquants ? (
            <span>
              {nbBloquants} erreur{nbBloquants > 1 ? 's' : ''} à corriger{' '}
              <button type="button" className="bouton bouton-lien" onClick={premiereErreur}>Aller à la première</button>
            </span>
          ) : <span>Aucune erreur{nbAvert ? ` · ${nbAvert} avertissement${nbAvert > 1 ? 's' : ''}` : ''}</span>
        )}
        {!enCours && echecVerif && <span>{echecVerif}</span>}
        {envoi && <span>{envoi}</span>}
        {anoFocus && <span className="saisie-message">{anoFocus.message}</span>}
      </p>
      <div className="saisie-pied" role="toolbar" aria-label="Actions de saisie">
        <LienModele annee={annee} mois={mois} lignes={() => lignes.map((l) => versApi(l, rubriques))}
          title="Ces lignes et les valeurs déjà tapées, à compléter dans Excel puis importer">
          Remplir plutôt dans Excel (modèle de ces lignes)
        </LienModele>
        <Bouton onClick={enregistrer} disabled={!pret}>Enregistrer…</Bouton>
      </div>
    </section>
  )
}

const Rangee = memo(function Rangee({ ligne, r, colonnes, anos, total, ignoree, onCellule, onRetirer, menu }: {
  ligne: Ligne
  r: number
  colonnes: Colonne[]
  anos?: AnosLigne
  total?: string
  ignoree: boolean
  onCellule: (e: ChangeEvent<HTMLInputElement>) => void
  onRetirer: (r: number) => void
  /** Liste de valeurs ouverte sur une cellule de cette ligne. */
  menu?: Menu
}) {
  const qui = ligne.nom || matriculeAffiche(ligne.matricule) || `ligne ${r + 1}`
  return (
    <tr className={ignoree ? 'ignoree' : undefined}>
      <td className="fige fige-1 gouttiere">
        <button type="button" className="retirer" onClick={() => onRetirer(r)} aria-label={`Retirer ${qui}`} title="Retirer la ligne">×</button>
      </td>
      {colonnes.map((c, j) => {
        const lecture = !!ligne._connu && j < 2
        const v = (c.cle === 'matricule' ? matriculeAffiche(ligne.matricule) : ligne[c.cle]) ?? ''
        const a = anos?.[c.cle]
        const ko = a?.gravite === 'bloquant' || (c.montant && !estMontant(v))
        const cls = [j < 2 && `fige fige-${j + 2}`, c.montant && 'num', c.exclu && 'exclu', ko ? 'ko' : a && 'avert']
        const ouvert = menu?.c === j
        const liste = c.liste
          ? {
              role: 'combobox', 'aria-autocomplete': 'list' as const, 'aria-expanded': ouvert,
              'aria-controls': ouvert ? ID_LISTE : undefined,
              'aria-activedescendant': ouvert && menu.actif >= 0 ? idOption(menu.actif) : undefined,
            }
          : {}
        return (
          <td key={c.cle} className={cls.filter(Boolean).join(' ') || undefined} title={a?.message}>
            <input
              data-r={r} data-c={j} value={v} onChange={onCellule} readOnly={lecture} tabIndex={lecture ? -1 : undefined}
              inputMode={c.montant ? 'decimal' : undefined} autoComplete="off" spellCheck={false}
              aria-label={`${c.titre}, ${qui}`} aria-invalid={ko || undefined} {...liste}
            />
          </td>
        )
      })}
      <td className="num total">{total === undefined ? '' : valeurBrute(total)}</td>
    </tr>
  )
})
