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

function Case({
  titre,
  valeur,
  note,
  devise = true,
  children,
}: {
  titre: string
  valeur: string
  note?: ReactNode
  devise?: boolean
  children?: ReactNode
}) {
  return (
    <div className="tuile case">
      <span className="micro">{titre}</span>
      <strong>
        {valeur}
        {devise && valeur !== '—' && <span className="devise"> FCFA</span>}
      </strong>
      {children}
      {note && <span className="note">{note}</span>}
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
  const nbMois = (n: number | undefined) => (n ? `${n} mois saisi${n > 1 ? 's' : ''}` : 'aucun mois saisi')

  return (
    <section className={`page-ecran page-etroite resume-excel${maj ? ' maj' : ''}`} aria-busy={maj || ann.isLoading || undefined}>
      <h2 className="bandeau-titre">RÉSUMÉ DES INDICATEURS</h2>
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
          <div className="cases">
            {['MASSE SALARIALE', 'COMMISSIONS', 'PRIMES PRODUCTIVITÉ', `MASSE SALARIALE ${n1}`].map((t) => (
              <Case key={t} titre={t} valeur="—" devise={false} note="—" />
            ))}
          </div>
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
          {aCa && (
            <div className="cases">
              <Case titre="CHIFFRE D’AFFAIRES" valeur={montrer(a.ca_ytd)} note={`cumul · ${nbMois(a.nb_mois_ca)}`} />
              <Case titre="MARGE" valeur={montrer(a.marge_ytd)} note={`saisie · ${nbMois(a.nb_mois_marge)}`} />
              <Case
                titre="TAUX DE MARGE"
                valeur={a.taux_marge_ytd == null ? '—' : pct(a.taux_marge_ytd)}
                devise={false}
                note="marge / CA"
              />
              <Case titre="MOYENNE MENSUELLE" valeur={montrer(a.moyenne_mensuelle.m)} note={`masse salariale · ${nbMois(a.cumul_ytd.nb_mois)}`} />
            </div>
          )}
          <div className="cases">
            <Case titre="MASSE SALARIALE" valeur={fcfa(a.cumul_ytd.m)} note={`cumul · ${nbMois(a.cumul_ytd.nb_mois)}`}>
              <Variation v={a.cumul_ytd.var_pct} vs={`vs ${n1}`} />
            </Case>
            <Case titre="COMMISSIONS" valeur={montrer(a.commissions_ytd)} note={`cumul · ${nbMois(a.cumul_ytd.nb_mois)}`} />
            <Case titre="PRIMES PRODUCTIVITÉ" valeur={montrer(a.primes_ytd)} note={`cumul · ${nbMois(a.cumul_ytd.nb_mois)}`} />
            <Case titre={`MASSE SALARIALE ${n1}`} valeur={montrer(a.cumul_ytd.m1)} note={`même période · ${nbMois(a.cumul_ytd.nb_mois_n1)}`} />
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
