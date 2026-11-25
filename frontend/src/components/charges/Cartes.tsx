import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { FiltresPage } from '../../api/rapports'
import type { Charges, LigneCharge } from '../../api/types'
import {
  NB, NOM_AXE, TYPES_SITE, type Evo, abr, abrC, bas, coutParVente, ent, fp, ligne3, num, pcServeur, rangsActivite,
  rangsContrat, sa, sens, sensVar, signeEnt, top3, typeSite,
} from '../../lib/charges'
import { libelleTexte } from '../../lib/periode'
import { ListeRangs, NotePartielle, SansDonnees, Sous, EvoCase } from './Petits'

export interface Libelles { prec: string; cour: string }

interface TuileProps {
  k: string
  nom: string
  valeur: string
  devise: string
  bulle: string
  search: string
  children?: ReactNode
}

/** Une carte cliquable : libellé, grand chiffre, ligne d'évolution, puis trois lignes. */
function Tuile({ k, nom, valeur, devise, bulle, search, children }: TuileProps) {
  return (
    <Link className="tuile case lien" to={{ search, hash: `#${k}` }} title={bulle}>
      <span className="micro">{nom}</span>
      <strong>{valeur}<span className="devise">{devise}</span></strong>
      {children}
    </Link>
  )
}

const aPlusieurs = (n: number, un: string, plusieurs: string) => (n > 1 ? plusieurs : un)

function CarteUnique({ k, nom, un, lignes, f, search, fem }: { k: 'site' | 'service' | 'marque'; nom: string; un: string; lignes: LigneCharge[]; f: FiltresPage; search: string; fem?: boolean }) {
  const lib = lignes[0]?.libelle ?? '—'
  const pq = f[k as 'site' | 'service'] ? 'le filtre' : 'la sélection'
  return (
    <Tuile k={k} nom={nom} valeur={ent(lignes.length)} devise={` ${un}`} search={search} bulle={`Clic : ${lib}, budget et personnes`}>
      <Sous g={`${lib} : ${fem ? 'seule' : 'seul'} ${un} dans ${pq}`} />
    </Tuile>
  )
}

/** Six cartes : un grand chiffre et trois lignes par axe, puis le tableau de l'axe au clic. */
export default function Cartes({ d, f, lib, search }: { d: Charges; f: FiltresPage; lib: Libelles; search: string }) {
  const n = num(d.total.m) ?? 0
  const n1 = num(d.total.m1)
  const comparee = libelleTexte(d.cmp_du, d.cmp_au)
  const T = { n, n1, lc: lib.prec, v: num(d.total.var), e: pcServeur(d.total.var_pct) }

  /* Types de charge */
  const lt = d.axes.type.lignes
  const t3type = top3(lt.map(ligne3), T)
  const bulleType = [
    num(d.hors_total.montant) && d.hors_total.nb_rubriques
      ? `Non compris dans le total : ${abr(num(d.hors_total.montant) as number)} FCFA (${d.hors_total.nb_rubriques} rubriques)`
      : '',
    'Clic : tous les types, budget et personnes',
  ].filter(Boolean).join('\n')

  /* Sites */
  const ls = d.axes.site.lignes
  const t3site = top3(ls.map(ligne3), T)
  const somSite: Record<string, number> = {}
  const nbSite: Record<string, number> = {}
  ls.forEach((x) => {
    const t = typeSite(x)
    somSite[t] = (somSite[t] ?? 0) + (num(x.m) ?? 0)
    nbSite[t] = (nbSite[t] ?? 0) + 1
  })
  const types = TYPES_SITE.filter(([t]) => nbSite[t])
  const bulleSite = [
    'Par type de site : ' + types.map(([t, u, p]) => `${nbSite[t]} ${aPlusieurs(nbSite[t], u, p)} ${t3site.mtU(somSite[t])}`).join(', '),
    'Clic : tous les sites, budget et personnes',
  ].join('\n')

  /* Services */
  const lv = d.axes.service.lignes
  const t3serv = top3(lv.map(ligne3), T)
  const cmp = lv.filter((x) => x.m1 != null).map((x) => num(x.var) ?? 0)
  const hausses = cmp.filter((v) => v > 0)
  const baisses = cmp.filter((v) => v < 0)
  const som = (l: number[]) => l.reduce((a, v) => a + v, 0)
  const bulleServ = [
    cmp.length ? `En hausse : +${t3serv.mtU(som(hausses))} ; en baisse : −${t3serv.mtU(Math.abs(som(baisses)))}` : '',
    'Clic : tous les services, budget et personnes',
  ].filter(Boolean).join('\n')

  /* Effectifs */
  const e = d.effectif.n
  const ve = d.effectif.var
  const ce = d.effectif.n1 != null && ve != null
  const evoEff: Evo | null = ce
    ? { sens: sens(ve), txt: fp(pcServeur(d.effectif.var_pct)), ecart: signeEnt(ve), couleur: false }
    : null

  /* Activité : coût par vente */
  const { v, v1, var: ecartAct, e: eAct } = coutParVente(d)
  const evoAct: Evo | null = v != null && v1 != null && ecartAct != null
    ? { sens: sensVar(ecartAct, eAct), txt: fp(eAct), ecart: sa(ecartAct) }
    : null
  const at = d.objectifs_atteints
  const rangsAct = d.activite ? rangsActivite(d.activite) : []

  return (
    <>
      <section className="groupe resume-excel" aria-label="Indicateurs par groupe">
        <div className="cases six">
          <Tuile k="type" nom={NOM_AXE.type} valeur={t3type.tot} devise=" FCFA" search={search} bulle={bulleType}>
            <Sous g={`Évolution par rapport à ${lib.prec}`}>{t3type.droite ? <EvoCase e={t3type.droite} /> : <SansDonnees />}</Sous>
            <ListeRangs rows={t3type.rows} />
          </Tuile>

          {ls.length <= 1 ? (
            <CarteUnique k="site" nom={NOM_AXE.site} un="site" lignes={ls} f={f} search={search} />
          ) : (
            <Tuile k="site" nom={NOM_AXE.site} valeur={ent(ls.length)} devise={aPlusieurs(ls.length, ' site', ' sites')} search={search} bulle={bulleSite}>
              <Sous g={types.map(([t, u, p]) => `${nbSite[t]} ${aPlusieurs(nbSite[t], u, p)}`).join(' · ')} />
              <ListeRangs rows={t3site.rows} />
            </Tuile>
          )}

          {lv.length <= 1 ? (
            <CarteUnique k="service" nom={NOM_AXE.service} un="service" lignes={lv} f={f} search={search} />
          ) : (
            <Tuile k="service" nom={NOM_AXE.service} valeur={ent(lv.length)} devise={aPlusieurs(lv.length, ' service', ' services')} search={search} bulle={bulleServ}>
              <Sous g={cmp.length ? `${hausses.length} en hausse · ${baisses.length} en baisse` : `pas de données depuis ${bas(lib.prec)}`} />
              <ListeRangs rows={t3serv.rows} />
            </Tuile>
          )}

          {/* Aucune donnée de marque côté serveur : carte annoncée, non cliquable. */}
          <div className="tuile case" title="Liste des marques attendue">
            <span className="micro">{NOM_AXE.marque}</span>
            <strong>—</strong>
            <Sous g="liste des marques attendue" />
          </div>

          <Tuile
            k="act"
            nom="Coût par vente"
            valeur={v == null ? '—' : abrC(v)}
            devise=" FCFA"
            search={search}
            bulle={'Coût par vente = charges ÷ nombre de ventes\nClic : ventes, CA, marge et objectifs en détail'}
          >
            <Sous g={at ? `objectifs atteints : ${at[0]} sur ${at[1]}` : 'charges ÷ ventes'}>
              {evoAct ? <EvoCase e={evoAct} /> : <SansDonnees />}
            </Sous>
            {rangsAct.length > 0 && <ListeRangs rows={rangsAct} />}
          </Tuile>

          <Tuile
            k="eff"
            nom={NOM_AXE.eff}
            valeur={ent(e)}
            devise=" pers."
            search={search}
            bulle={`${e} personnes payées sur la période\nEntrée : payée sur la période, pas sur la période comparée ; sortie : l'inverse`}
          >
            <Sous g={ce ? `${d.entrees ?? 0} entrées · ${d.sorties ?? 0} sorties` : ''}>
              {evoEff ? <EvoCase e={evoEff} /> : <SansDonnees />}
            </Sous>
            <ListeRangs rows={rangsContrat(d.effectifs_contrat, ce)} />
          </Tuile>
        </div>
      </section>
      <div className="charges-note">
        <p>
          ▲▼ comparé{comparee ? ` à ${bas(comparee)}` : ''}. Couleur seulement pour les écarts forts (≥ 20{NB}%).
          Survoler une ligne pour le détail. K = milliers, M = millions de FCFA.
        </p>
        {d.partiel && <NotePartielle />}
      </div>
    </>
  )
}
