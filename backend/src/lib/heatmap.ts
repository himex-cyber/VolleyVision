// Court-zone heat map: per zone (1-6, FIVB numbering) attack, serve, pass and
// defence numbers, built from { courtZone, eventType } rows. Ported from tag
// pre-feature-removal. Queries fetch rows WITHOUT a zone filter so `coverage`
// can say how much of the data the map is based on: a zone is optional when
// tracking, and a map built from 5 of 80 attacks shouldn't look authoritative.

export interface ZoneAttack  { kills: number; errors: number; attempts: number; hittingPct: number | null }
export interface ZoneServe   { aces: number; errors: number; serveIn: number; attempts: number; efficiency: number | null }
export interface ZonePass    { pass3: number; pass2: number; pass1: number; pass0: number; attempts: number; rating: number | null }
export interface ZoneDefence { digs: number; soloBlocks: number; blockAssists: number; total: number }

export type DetailedZoneStats = {
  attack:  Record<string, ZoneAttack>;
  serve:   Record<string, ZoneServe>;
  pass:    Record<string, ZonePass>;
  defence: Record<string, ZoneDefence>;
  /** Of the actions the map shows, how many have a valid zone. */
  coverage: { tagged: number; total: number };
};

const ZONES = ['1', '2', '3', '4', '5', '6'];

type Acc = {
  aKills: number; aErrors: number; aInPlay: number;
  sAces: number; sErrors: number; sIn: number;
  p3: number; p2: number; p1: number; p0: number;
  digs: number; soloBlocks: number; blockAssists: number;
};

// The event types the map shows, and which counter each feeds.
const COUNTER: Record<string, keyof Acc> = {
  KILL: 'aKills',
  ATTACK_ERROR: 'aErrors',
  ATTACK_ATTEMPT: 'aInPlay',
  TIP: 'aInPlay',       // non-scoring attack attempt
  FREE_BALL: 'aInPlay', // non-scoring attack attempt
  ACE: 'sAces',
  SERVICE_ERROR: 'sErrors',
  SERVE_IN: 'sIn',
  PASS_3: 'p3',
  PASS_2: 'p2',
  PASS_1: 'p1',
  PASS_0: 'p0',
  DIG: 'digs',
  SOLO_BLOCK: 'soloBlocks',
  BLOCK_ASSIST: 'blockAssists',
};

export function buildDetailedHeatmap(
  events: { courtZone: number | null; eventType: string }[],
): DetailedZoneStats {
  const acc: Record<string, Acc> = {};
  for (const z of ZONES) {
    acc[z] = { aKills: 0, aErrors: 0, aInPlay: 0, sAces: 0, sErrors: 0, sIn: 0,
               p3: 0, p2: 0, p1: 0, p0: 0, digs: 0, soloBlocks: 0, blockAssists: 0 };
  }
  let tagged = 0;
  let total = 0;
  for (const e of events) {
    const counter = COUNTER[e.eventType];
    if (!counter) continue;
    total++;
    const zone = e.courtZone == null ? undefined : acc[String(e.courtZone)];
    if (!zone) continue; // null or out of range: untagged
    tagged++;
    zone[counter]++;
  }

  const r2 = (n: number) => Math.round(n * 100) / 100;
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  const attack:  Record<string, ZoneAttack>  = {};
  const serve:   Record<string, ZoneServe>   = {};
  const pass:    Record<string, ZonePass>    = {};
  const defence: Record<string, ZoneDefence> = {};
  for (const z of ZONES) {
    const a = acc[z];
    const attackAttempts = a.aKills + a.aErrors + a.aInPlay;
    attack[z] = {
      kills: a.aKills, errors: a.aErrors, attempts: attackAttempts,
      hittingPct: attackAttempts > 0 ? r3((a.aKills - a.aErrors) / attackAttempts) : null,
    };
    const serveAttempts = a.sAces + a.sErrors + a.sIn;
    serve[z] = {
      aces: a.sAces, errors: a.sErrors, serveIn: a.sIn, attempts: serveAttempts,
      efficiency: serveAttempts > 0 ? r2((a.sAces - a.sErrors) / serveAttempts) : null,
    };
    const passAttempts = a.p3 + a.p2 + a.p1 + a.p0;
    pass[z] = {
      pass3: a.p3, pass2: a.p2, pass1: a.p1, pass0: a.p0, attempts: passAttempts,
      rating: passAttempts > 0 ? r2((3 * a.p3 + 2 * a.p2 + 1 * a.p1) / passAttempts) : null,
    };
    defence[z] = {
      digs: a.digs, soloBlocks: a.soloBlocks, blockAssists: a.blockAssists,
      total: a.digs + a.soloBlocks + a.blockAssists,
    };
  }
  return { attack, serve, pass, defence, coverage: { tagged, total } };
}
