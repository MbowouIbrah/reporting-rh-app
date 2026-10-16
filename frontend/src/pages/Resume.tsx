import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { getAnnuel } from '../api/rapports'
import type { Val } from '../api/types'
import Etat, { etatErreur } from '../components/Etat'
import BoutonReinitialiser from '../components/BoutonReinitialiser'
import { ChoixComparaison } from '../components/FiltresPeriode'
import { Variation } from '../components/Tuile'
import { useFiltres } from '../hooks/useFiltres'
import { cls, fcfa, MOIS, pct } from '../lib/format'
import { TitreRapport } from '../components/ExportPdf'

function Case({
  titre,
  valeur,
  devise = true,
  libelle2,
  children,
}: {
  titre: string
  valeur: string
  devise?: boolean
  /** Libellé de l'élément secondaire, à gauche sous le titre ; sa valeur (children) sous la valeur. */
  libelle2?: string
  children?: ReactNode
}) {
  return (
    <div className="tuile case">
      <span className="micro">{titre}</span>
      <strong>
        {valeur}
        {devise && valeur !== '—' && <span className="devise"> FCFA</span>}
      </strong>
      {libelle2 && <span className="second-libelle">{libelle2}</span>}
      {children}
    </div>
  )
}

export default function Resume() {
  const f = useFiltres({ avecMois: false, comparaison: 'annee' })
  // Résumé annuel : cumul de l'année jusqu'au dernier mois saisi ; service/site ne s'appliquent pas (CA global).
  const base = f.filtres && { annee: f.filtres.annee, mois: f.filtres.mois, ref_annee: f.filtres.ref_annee }
  const ann = useQuery({
    queryKey: ['annuel', base],
    queryFn: () => getAnnuel(base!),
    enabled: !!base,
    placeholderData: keepPreviousData,
  })
  const maj = ann.isPlaceholderData
  const n1 = f.filtres ? `${f.filtres.ref_annee ?? f.filtres.annee - 1}` : 'N-1'
  const erreur = ann.error
  const a = ann.data
  const aCa = a !== undefined && a.serie_n.length > 0 && 'ca' in a.serie_n[0]
  const montrer = (v: Val | undefined) => (v === undefined || v === null ? '—' : fcfa(v))

  return (
    <section className={`page-ecran page-etroite resume-excel${maj ? ' maj' : ''}`} aria-busy={maj || ann.isLoading || undefined}>
      <TitreRapport titre="RÉSUMÉ DES INDICATEURS" />
      {f.filtres && (
        <div className="filtre-annee">
          <label className="selecteur-annee">
            <span className="filtre-annee-label">Année</span>
            <select value={f.filtres.annee} onChange={(e) => f.set({ annee: e.target.value })}>
              {f.annees.map((an) => (
                <option key={an}>{an}</option>
              ))}
            </select>
          </label>
          <span className="selecteur-annee">
            <ChoixComparaison mode="annee" filtres={f.filtres} annees={f.annees} onChange={f.set} />
            <BoutonReinitialiser
              actif={!!(f.partage.annee || f.partage.cmp_annee)}
              onClick={() => f.set({ annee: undefined, cmp_annee: undefined })}
            />
          </span>
        </div>
      )}
      {f.vide && <Etat type="vide" />}
      {ann.isLoading && (
        // Premier chargement : cases et tableau à leur taille définitive, seules les valeurs en squelette.
        <>
          {[['COMMISSIONS', 'MASSE SALARIALE', 'EFFECTIF MOYEN'], ['PRIMES DE PRODUCTIVITÉ', 'MOYENNE MENSUELLE']].map((ligne) => (
            <div key={ligne[0]} className="cases">
              {ligne.map((t) => (
                <Case key={t} titre={t} valeur="—" devise={false} />
              ))}
            </div>
          ))}
          <h3 className="bandeau-titre">SUIVI MENSUEL</h3>
          <div className="table-scroll">
            <table className="dense suivi">
              <thead>
                <tr>{['MOIS', 'MASSE SALARIALE', 'COMMISSIONS', 'PRIMES PROD.'].map((c) => <th key={c} scope="col">{c}</th>)}</tr>
              </thead>
              <tbody aria-hidden="true">
                {MOIS.map((m) => (
                  <tr key={m}>
                    <th scope="row">{m}</th>
                    <td className="num" />
                    <td className="num" />
                    <td className="num" />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {erreur && <Etat type={etatErreur(erreur)} />}
      {a && (
        <>
          {/* Lecture par colonne (retour du 15/10) : CA puis marge, commissions puis primes, masse salariale
              puis moyenne, effectifs puis CA / effectif. Pas de rappel « n mois saisis » : déjà connu. */}
          <div className="cases">
            {aCa && (
              <Case titre="CHIFFRE D’AFFAIRES" valeur={montrer(a.ca_ytd)} libelle2={`Par rapport à ${n1}`}>
                <Variation v={a.ca_cumul?.var_pct} vs="" />
              </Case>
            )}
            <Case titre="COMMISSIONS" valeur={montrer(a.commissions_ytd)} libelle2={`Par rapport à ${n1}`}>
              <Variation v={a.commissions_cumul.var_pct} vs="" />
            </Case>
            <Case titre="MASSE SALARIALE" valeur={fcfa(a.cumul_ytd.m)} libelle2={`Par rapport à ${n1}`}>
              <Variation v={a.cumul_ytd.var_pct} vs="" />
            </Case>
            <Case titre="EFFECTIF MOYEN" valeur={montrer(a.effectif_moyen.m)} devise={false} libelle2="Part des MAD">
              <span className="second">{a.taux_mad == null ? '—' : pct(a.taux_mad)}</span>
            </Case>
          </div>
          <div className="cases">
            {aCa && (
              // Pas d'évolution sur la marge : le taux prend sa place, en second plan.
              <Case titre="MARGE" valeur={montrer(a.marge_ytd)} libelle2="Taux de marge">
                <span className="second">{a.taux_marge_ytd == null ? '—' : pct(a.taux_marge_ytd)}</span>
              </Case>
            )}
            <Case titre="PRIMES DE PRODUCTIVITÉ" valeur={montrer(a.primes_ytd)} libelle2={`Par rapport à ${n1}`}>
              <Variation v={a.primes_cumul.var_pct} vs="" />
            </Case>
            <Case titre="MOYENNE MENSUELLE" valeur={montrer(a.moyenne_mensuelle.m)} libelle2={`Par rapport à ${n1}`}>
              <Variation v={a.moyenne_mensuelle.var_pct} vs="" />
            </Case>
            {aCa && (
              <Case titre="CA PAR SALARIÉ" valeur={montrer(a.ca_par_effectif?.m)} libelle2={`Par rapport à ${n1}`}>
                <Variation v={a.ca_par_effectif?.var_pct} vs="" />
              </Case>
            )}
          </div>
          {aCa && (
            <p className="regle">
              Le CA et la marge sont saisis chaque mois par l’administration RH. Un mois non saisi reste
              vide ; le taux de marge ne porte que sur les mois où les deux sont connus.
            </p>
          )}
        </>
      )}
      {a && (
        <>
          <h3 className="bandeau-titre">SUIVI MENSUEL</h3>
          <div className="table-scroll">
            <table className="dense suivi">
              <thead>
                <tr>
                  <th scope="col">MOIS</th>
                  {aCa && <th scope="col">CA</th>}
                  <th scope="col">MASSE SALARIALE</th>
                  {aCa && <th scope="col">MARGE</th>}
                  {aCa && <th scope="col">% MARGE</th>}
                  <th scope="col">COMMISSIONS</th>
                  <th scope="col">PRIMES PROD.</th>
                </tr>
              </thead>
              <tbody>
                {a.serie_n.map((l) => (
                  <tr key={l.mois}>
                    <th scope="row">{MOIS[l.mois - 1]}</th>
                    {aCa && <td className="num saisi">{montrer(l.ca)}</td>}
                    <td className="num">{fcfa(l.ms)}</td>
                    {aCa && <td className={`${cls(l.marge)} saisi`}>{montrer(l.marge)}</td>}
                    {aCa && <td className={cls(l.taux_marge)}>{l.taux_marge == null ? '—' : pct(l.taux_marge)}</td>}
                    <td className="num">{fcfa(l.commissions)}</td>
                    <td className="num">{fcfa(l.primes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
